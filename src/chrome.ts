// A headless Chrome the server draws a view in for an agent's look (src/looks.ts), driven over the DevTools protocol
// with nothing but Node's own WebSocket. Either the Chrome of another container, named by PELAGO_CHROME (its DevTools
// address, http://renderer:9222), or one this process starts from where Chrome is installed (CHROME, or the usual
// places), as the tests do. Each look gets a browser context of its own: no storage, no cookies, nothing of the last.

import { spawn, type ChildProcess } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLACES = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];

/** Where Chrome is installed here, or null. */
export const chromeBinary = (): string | null => [process.env.CHROME, ...PLACES].find((p): p is string => Boolean(p && existsSync(p))) ?? null;

/** Whether this server has a Chrome to draw in: another container's, or one installed here. */
export const canDraw = () => Boolean(process.env.PELAGO_CHROME || chromeBinary());

export interface Tab {
  /** A DevTools command for this tab. */
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  /** An expression evaluated in the page, its value returned. */
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  /** The events this tab has heard, by method. */
  heard: (method: string) => unknown[];
  close: () => Promise<void>;
}

export interface Browser {
  /** A blank tab in a context of its own. */
  tab: () => Promise<Tab>;
  close: () => void;
  closed: Promise<void>;
}

/** A DevTools address with its host as an address: Chrome answers /json only to a Host that is an IP or localhost. */
async function plainHost(url: URL): Promise<URL> {
  if (isIP(url.hostname) || url.hostname === 'localhost') return url;
  const out = new URL(url);
  out.hostname = (await lookup(url.hostname)).address;
  return out;
}

/** Start the Chrome installed here; its DevTools address and how to stop it. */
async function start(binary: string): Promise<{ ws: string; stop: () => void }> {
  // A server stopped while its Chrome ran leaves that Chrome's folder: a later start removes those over a day old.
  for (const old of readdirSync(tmpdir())) {
    const at = join(tmpdir(), old);
    try {
      if (old.startsWith('pelago-look-') && Date.now() - statSync(at).mtimeMs > 86_400_000) rmSync(at, { recursive: true, force: true });
    } catch {}
  }
  const dir = mkdtempSync(join(tmpdir(), 'pelago-look-'));
  // Chrome's own temp files (an extension the machine installs in every new profile is unpacked there) go in its
  // folder too, so that removing the folder removes them.
  const temp = join(dir, 'temp');
  mkdirSync(temp);
  // In a container Chrome cannot make its own sandbox as a normal user: there the container is the wall.
  const bare = process.env.CI || process.env.PELAGO_CHROME_NO_SANDBOX ? ['--no-sandbox'] : [];
  const proc: ChildProcess = spawn(binary, ['--headless=new', ...bare, '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
  const ws = await new Promise<string>((resolve, reject) => {
    let said = '';
    const timer = setTimeout(() => (proc.kill(), reject(new Error(`Chrome did not start: ${said.slice(0, 300)}`))), 30000);
    proc.stderr!.on('data', (chunk) => {
      said += String(chunk);
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(said);
      if (found) (clearTimeout(timer), resolve(found[1]));
    });
    proc.once('exit', () => (clearTimeout(timer), reject(new Error(`Chrome stopped as it started: ${said.slice(0, 300)}`))));
  });
  // Chrome holds its folder until it has exited, and on Windows its helpers for some seconds after: removed once it
  // has, tried again for a while without holding the server up.
  const remove = () => void rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
  return { ws, stop: () => (proc.exitCode !== null || proc.signalCode !== null ? remove() : (proc.once('exit', remove), proc.kill())) };
}

/** A Chrome to draw in: PELAGO_CHROME's, else one started here. */
export async function openBrowser(): Promise<Browser> {
  let ws: string, stop = () => {};
  if (process.env.PELAGO_CHROME) {
    const at = await plainHost(new URL(process.env.PELAGO_CHROME));
    const version = (await (await fetch(new URL('/json/version', at), { signal: AbortSignal.timeout(5000) })).json()) as { webSocketDebuggerUrl: string };
    const said = new URL(version.webSocketDebuggerUrl);
    said.host = at.host;
    ws = said.href;
  } else {
    const binary = chromeBinary();
    if (!binary) throw new Error('This server has no Chrome to draw in: set PELAGO_CHROME or CHROME.');
    ({ ws, stop } = await start(binary));
  }
  const socket = new WebSocket(ws);
  await new Promise((resolve, reject) => ((socket.onopen = resolve), (socket.onerror = () => reject(new Error('Chrome’s DevTools did not answer.')))));
  let id = 0;
  const waiting = new Map<number, { resolve: (m: any) => void; reject: (e: Error) => void }>();
  const events = new Map<string, Map<string, unknown[]>>();
  let ended!: () => void;
  const closed = new Promise<void>((r) => (ended = r));
  socket.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    const w = m.id && waiting.get(m.id);
    if (w) return (waiting.delete(m.id), m.error ? w.reject(new Error(`${m.error.message}`)) : w.resolve(m.result));
    const of = m.sessionId && events.get(m.sessionId);
    if (of) of.set(m.method, [...(of.get(m.method) ?? []), m.params]);
  };
  socket.onclose = () => {
    for (const w of waiting.values()) w.reject(new Error('Chrome went away.'));
    waiting.clear();
    ended();
  };
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<any>((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) return reject(new Error('Chrome went away.'));
      const n = ++id;
      waiting.set(n, { resolve, reject });
      socket.send(JSON.stringify({ id: n, method, params, ...(sessionId && { sessionId }) }));
    });
  return {
    closed,
    close: () => (socket.close(), stop()),
    tab: async () => {
      const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true });
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      events.set(sessionId, new Map());
      const mine = (method: string, params?: Record<string, unknown>) => send(method, params, sessionId);
      return {
        send: mine,
        heard: (method) => events.get(sessionId)?.get(method) ?? [],
        evaluate: async (expression) => {
          const m = await mine('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
          if (m.exceptionDetails) throw new Error(m.exceptionDetails.exception?.description ?? m.exceptionDetails.text);
          return m.result?.value;
        },
        close: async () => {
          events.delete(sessionId);
          await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
        },
      };
    },
  };
}
