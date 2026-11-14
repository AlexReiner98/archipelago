// A headless Chrome for the tests that need a real browser, driven over the DevTools protocol with nothing but
// Node's own WebSocket. Where no Chrome is found (CHROME, or where it is usually installed), `chrome()` says so and
// those tests are skipped: on a machine, not in CI, where a missing Chrome would let them all pass unrun.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeBinary } from '../packs/look_draw/kernel/chrome.ts';
import { until, wait } from './wait.ts';

export { until, wait };

/** Where Chrome is, or null: where the server looks for the one it draws looks in (packs/look_draw/kernel/chrome.ts). In CI there is no
 * null: a file of browser tests that finds no Chrome there fails, rather than skipping every test in it. */
export function chrome(): string | null {
  const found = chromeBinary();
  if (!found && process.env.CI) throw new Error('CI has no Chrome, so every browser test would pass as skipped: install it, or set CHROME to where it is');
  return found;
}

/** An expression importing the page's own copy of one of its modules (`live.js`), at the version it loads them at
 * (packs/surface/kernel/ui-files.ts): a bare address would load a second copy, with state and timers of its own. */
export const pageModule = (name: string) => `import('/${name}' + new URL(document.querySelector('link[href^="/base.js"]').href).search)`;

export interface Page {
  /** Open another address in the same page (the same browser, its storage kept). */
  go: (url: string) => Promise<void>;
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  /** Whether `expression` comes to be truthy in the page within ms, asked every `every` ms. */
  until: (expression: string, ms?: number, every?: number) => Promise<boolean>;
  /** Whether the page comes to stand still within ms: no animation running, and `watch` (an expression, a picture's
   * place say) reading the same over a few frames. What a test waits for before it measures or after it moves. */
  still: (watch?: string, ms?: number) => Promise<boolean>;
  /** A DevTools command, for what the rest does not cover (emulating less motion, say). */
  send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>;
  /** The page as it looks, as a PNG. */
  screenshot: () => Promise<Buffer>;
  /** What the page logged and threw. */
  logs: () => string[];
  close: () => Promise<void>;
}

/** A page at url, in a Chrome of its own. */
export async function open(url: string): Promise<Page> {
  const binary = chrome();
  if (!binary) throw new Error('No Chrome here: set CHROME');
  const dir = mkdtempSync(join(tmpdir(), 'pelago-chrome-'));
  // A CI runner (GitHub's Ubuntu) does not let Chrome make its sandbox as a normal user, so there it runs without one.
  const ci = process.env.CI ? ['--no-sandbox'] : [];
  // Chrome says on its error stream where it listens. On a busy runner (many test files each starting one) it can be
  // slow to: it is given 45 seconds, and started once more if it says nothing by then.
  const start = () => {
    const proc: ChildProcess = spawn(binary, ['--headless=new', ...ci, '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-gpu', '--window-size=1280,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const address = new Promise<string>((resolve, reject) => {
      let said = '';
      const timer = setTimeout(() => (proc.kill(), reject(new Error(`Chrome did not start: ${said.slice(0, 300)}`))), 45000);
      proc.stderr!.on('data', (chunk) => {
        said += String(chunk);
        const found = /DevTools listening on (ws:\/\/\S+)/.exec(said);
        if (found) (clearTimeout(timer), resolve(found[1]));
      });
    });
    return { proc, address };
  };
  let started = start();
  const address = await started.address.catch(() => ((started = start()), started.address));
  const { proc } = started;
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
  // A session (Target.attachToTarget, flatten) speaks to a frame in a process of its own: a sandboxed frame is isolated.
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<any>((resolve) => {
      const n = ++id;
      waiting.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId && { sessionId }) }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  // PELAGO_THROTTLE=<rate> slows Chrome's CPU that many times, the page and every frame of its own process it starts
  // (the parts' walled frame), so a run here meets the timing of a loaded CI runner. Nothing is paused to do it: a
  // worker Chrome cannot slow (it answers an error) starts as ever, within the time the frame gives it.
  const rate = Number(process.env.PELAGO_THROTTLE);
  if (rate > 1) {
    const slow = (sessionId?: string) => send('Emulation.setCPUThrottlingRate', { rate }, sessionId);
    const attach = (sessionId?: string) => send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.method === 'Target.attachedToTarget') void slow(m.params.sessionId).then(() => attach(m.params.sessionId));
    });
    await slow();
    await attach();
  }
  const go = async (to: string) => {
    events.length = 0;
    // Only the hash moved: the page stays, and no load follows (Chrome gives no loader for it). A test waits for what
    // the page then draws.
    if (!(await send('Page.navigate', { url: to })).result?.loaderId) return;
    for (let n = 0; n < 200 && !events.some((e) => e.method === 'Page.loadEventFired'); n++) await new Promise((r) => setTimeout(r, 25));
  };
  await go(url);
  const evaluate = async <T = unknown>(expression: string): Promise<T> => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? JSON.stringify(m.result.exceptionDetails));
    return m.result?.result?.value;
  };
  return {
    go,
    send,
    evaluate,
    until: (expression, ms = 20_000, every = 50) => until(() => evaluate(expression), ms, every),
    still: (watch = 'null', ms = 10_000) =>
      until(() => evaluate(`(async () => {
        const moving = () => document.getAnimations().some((a) => a.playState === 'running');
        const at = JSON.stringify(${watch});
        for (let n = 0; n < 5; n++) {
          await new Promise((r) => requestAnimationFrame(r));
          if (moving() || JSON.stringify(${watch}) !== at) return false;
        }
        return true;
      })()`), ms, 0),
    screenshot: async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).result.data, 'base64'),
    logs: () => events.filter((e) => e.method === 'Runtime.consoleAPICalled' || e.method === 'Runtime.exceptionThrown').map((e) => JSON.stringify(e.params).slice(0, 500)),
    // Chrome holds its profile until it has exited (on Windows, a while after the kill): wait for that, then remove it.
    close: async () => {
      ws.close();
      const exited = proc.exitCode !== null || proc.signalCode !== null ? Promise.resolve() : new Promise((r) => proc.once('exit', r));
      proc.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    },
  };
}
