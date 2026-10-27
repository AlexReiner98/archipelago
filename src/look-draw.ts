// A view drawn for an agent's look, in the server's headless Chrome (src/chrome.ts): the app's own page, opened in
// look mode with a pass that reads as the agent (src/looks.ts), so the drawing, its sandboxed frame and a style's own
// code run exactly as they do for any reader. The page says when it has drawn (`data-look` on its root: ui/look.js);
// then the picture is taken twice, a moment apart, to say whether it had settled. Looks are drawn one at a time in
// this process; Chrome is started on the first and stopped when none has come for IDLE_MS.

import { openBrowser, type Browser } from './chrome.ts';

/** How long Chrome is kept after the last look. */
const IDLE_MS = 5 * 60_000;
/** The longest a view is given to say it has drawn. */
const DRAW_MS = 15_000;
/** Past this a PNG is sent as a JPEG instead: a picture is for reading, not for keeping. */
const PNG_MOST = 400_000;

export interface Drawn {
  data: Buffer;
  content_type: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  /** What the page said: drawn, or empty (the lens found nothing), or error, with why. */
  state: 'drawn' | 'empty' | 'error' | 'late';
  why?: string;
  /** Whether two pictures a moment apart were the same: false for a drawing that moves. */
  settled: boolean;
  ms: number;
}

let browser: Promise<Browser> | null = null;
let idle: NodeJS.Timeout | undefined;
let queue: Promise<unknown> = Promise.resolve();

const getBrowser = () => {
  if (!browser) {
    const opening = openBrowser();
    browser = opening;
    // Chrome gone (stopped, crashed, its container restarted): the next look starts it again.
    opening.then((b) => b.closed.then(() => browser === opening && (browser = null)), () => browser === opening && (browser = null));
  }
  return browser;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Draw `address` (the app's page, in look mode) at this size, once the queue reaches it. */
export function drawLook(address: string, pass: string, width: number, height: number, scheme: 'dark' | 'light'): Promise<Drawn> {
  const turn = queue.then(() => drawNow(address, pass, width, height, scheme));
  queue = turn.catch(() => {});
  return turn;
}

async function drawNow(address: string, pass: string, width: number, height: number, scheme: 'dark' | 'light'): Promise<Drawn> {
  clearTimeout(idle);
  const began = Date.now();
  const tab = await (await getBrowser()).tab();
  try {
    await tab.send('Page.enable');
    await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    // The page, and a style's code, take dark or light from the system's scheme: this one look's.
    await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    // The pass is the page's token for this one look: put where the page reads its token, before any of its code runs.
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('pelago-token', ${JSON.stringify(pass)}); } catch {}` });
    await tab.send('Page.navigate', { url: address });
    let said: { state?: string; why?: string } = {};
    for (const until = Date.now() + DRAW_MS; Date.now() < until; await wait(150)) {
      said = (await tab.evaluate<{ state?: string; why?: string }>(`({ state: document.documentElement.dataset.look, why: document.documentElement.dataset.lookWhy })`).catch(() => ({}))) ?? {};
      if (said.state && said.state !== 'drawing') break;
    }
    const state = (['drawn', 'empty', 'error'].includes(String(said.state)) ? said.state : 'late') as Drawn['state'];
    const shot = async (format: 'png' | 'jpeg') => Buffer.from((await tab.send('Page.captureScreenshot', { format, ...(format === 'jpeg' && { quality: 80 }) })).data, 'base64');
    // Settled: the same picture twice, a moment apart; a drawing that moves is taken as it stands on the third.
    let last = await shot('png'), settled = false;
    for (let n = 0; n < 3 && !settled; n++) {
      await wait(300);
      const now = await shot('png');
      settled = now.equals(last);
      last = now;
    }
    const jpeg = last.length > PNG_MOST;
    const why = state === 'late' ? `The view did not say it had drawn within ${DRAW_MS / 1000} s: this is how it stood.` : said.why;
    return { data: jpeg ? await shot('jpeg') : last, content_type: jpeg ? 'image/jpeg' : 'image/png', width, height, state, ...(why && { why: why.slice(0, 300) }), settled, ms: Date.now() - began };
  } finally {
    await tab.close();
    clearTimeout(idle);
    idle = setTimeout(async () => {
      const b = await browser?.catch(() => null);
      browser = null;
      b?.close();
    }, IDLE_MS);
    idle.unref();
  }
}

/** Stop the Chrome this process started, if any: for a server closing, and for tests. */
export async function stopDrawing() {
  clearTimeout(idle);
  const b = await browser?.catch(() => null);
  browser = null;
  b?.close();
}
