// A headless Chrome for the tests that need a real browser, driven over the DevTools protocol with nothing but
// Node's own WebSocket. Where no Chrome is found (CHROME, or where it is usually installed), `chrome()` says so and
// those tests are skipped.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLACES = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];

/** Where Chrome is, or null. */
export const chrome = (): string | null => [process.env.CHROME, ...PLACES].find((p): p is string => Boolean(p && existsSync(p))) ?? null;

export interface Page {
  /** Open another address in the same page (the same browser, its storage kept). */
  go: (url: string) => Promise<void>;
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  /** The page as it looks, as a PNG. */
  screenshot: () => Promise<Buffer>;
  /** What the page logged and threw. */
  logs: () => string[];
  close: () => void;
}

/** A page at url, in a Chrome of its own. */
export async function open(url: string): Promise<Page> {
  const binary = chrome();
  if (!binary) throw new Error('No Chrome here: set CHROME');
  const dir = mkdtempSync(join(tmpdir(), 'pelago-chrome-'));
  // A CI runner (GitHub's Ubuntu) does not let Chrome make its sandbox as a normal user, so there it runs without one.
  const ci = process.env.CI ? ['--no-sandbox'] : [];
  const proc: ChildProcess = spawn(binary, ['--headless=new', ...ci, '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  // Chrome says on its error stream where it listens.
  const address = await new Promise<string>((resolve, reject) => {
    let said = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not start: ${said.slice(0, 300)}`)), 15000);
    proc.stderr!.on('data', (chunk) => {
      said += String(chunk);
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(said);
      if (found) (clearTimeout(timer), resolve(found[1]));
    });
  });
  const port = new URL(address).port;
  let target: { type: string; webSocketDebuggerUrl: string } | undefined;
  for (let n = 0; n < 50 && !target; n++) {
    target = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === 'page');
    if (!target) await new Promise((r) => setTimeout(r, 100));
  }
  const ws = new WebSocket(target!.webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  let id = 0;
  const waiting = new Map<number, (m: any) => void>();
  const events: { method: string; params: unknown }[] = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && waiting.has(m.id)) (waiting.get(m.id)!(m), waiting.delete(m.id));
    else events.push(m);
  };
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve) => {
      const n = ++id;
      waiting.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  const go = async (to: string) => {
    events.length = 0;
    await send('Page.navigate', { url: to });
    for (let n = 0; n < 200 && !events.some((e) => e.method === 'Page.loadEventFired'); n++) await new Promise((r) => setTimeout(r, 25));
  };
  await go(url);
  return {
    go,
    evaluate: async (expression) => {
      const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? JSON.stringify(m.result.exceptionDetails));
      return m.result?.result?.value;
    },
    screenshot: async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).result.data, 'base64'),
    logs: () => events.filter((e) => e.method === 'Runtime.consoleAPICalled' || e.method === 'Runtime.exceptionThrown').map((e) => JSON.stringify(e.params).slice(0, 500)),
    close: () => {
      ws.close();
      proc.kill();
      setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }, 1000);
    },
  };
}
