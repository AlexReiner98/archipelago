// A view drawn for an agent's look, in the server's headless Chrome (packs/look_draw/kernel/chrome.ts): the app's own page, opened in
// look mode with a pass that reads as the agent (packs/look_draw/kernel/looks.ts), so the drawing, its sandboxed frame and a style's own
// code run exactly as they do for any reader. The page says when it has drawn (`data-look` and `data-look_why` on its root, published by look_draw's part: packs/look_draw/parts/page);
// then the picture is taken twice, a moment apart, to say whether it had settled, and the faces its text was drawn in
// are read off Chrome, to say which fell back to another (decision e_vr5vyrhr: said, never installed). Up to AT_ONCE
// looks are drawn at a time in this process, each in a tab of its own, and none waits for a turn past WAIT_MS or is
// drawn past LATE_MS: a page that never yields is answered for, not waited on. Chrome is started on the first and
// stopped when none has come for IDLE_MS.

import { openBrowser, type Browser, type Tab } from './chrome.ts';

/** A catch that says what failed and answers `fallback` (as src/logged.ts does): a drawing's extras never fail it. */
const logged = <T = undefined>(what: string, fallback?: T) => (err: unknown): T => {
  console.error(`${what}: ${err instanceof Error ? err.message : String(err)}`);
  return fallback as T;
};

/** How long Chrome is kept after the last look. */
const IDLE_MS = 5 * 60_000;
/** The longest a view is given to say it has drawn. */
const DRAW_MS = 15_000;
/** How many looks are drawn at once. */
const AT_ONCE = 3;
/** The longest a look waits for its turn. */
const WAIT_MS = 60_000;
/** The longest one drawing takes, from its turn to its picture. */
const LATE_MS = 45_000;
/** Past this a PNG is sent as a JPEG instead: a picture is for reading, not for keeping. */
const PNG_MOST = 400_000;
/** Past this a drawing's marks are not sent: the picture is, as for a drawing with no marks. */
const MARKS_MOST = 1_500_000;

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
  /** The drawing as marks, where they were asked for and it has them (packs/walls/page/look-marks.js). */
  marks?: Marks;
  /** Each face the page asked for and Chrome drew another in: the first named in its family, and what drew instead. */
  fell_back?: { asked: string; drawn: string }[];
  /** What the page's parts drew with, one for each island it drew parts on (packs/loader/kernel/pack-versions.ts, Drew). */
  drew?: unknown[];
  /** A dry run's: what its drawings said went wrong, each once, the first first. */
  errors?: string[];
}

/** Code not yet saved, drawn in place of a field the map holds (packs/surface/kernel/tool-preview.ts, Preview): the page's tries, set before its code runs. */
export interface Try {
  item: string;
  field: string;
  value: unknown;
  title: string;
  drawing?: unknown;
  at: number;
}

/** A drawing as marks: what an inline view mounts, with no code of the drawing's. */
export interface Marks {
  id: string;
  html: string;
  css: string;
  vars: Record<string, string>;
  width: number;
  height: number;
}

let browser: Promise<Browser> | null = null;
let idle: NodeJS.Timeout | undefined;
let drawing = 0;
const waiting: (() => void)[] = [];

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

/** A turn to draw: at once while fewer than AT_ONCE are drawing, else when one ends, else refused after WAIT_MS. */
async function turn(): Promise<() => void> {
  if (drawing >= AT_ONCE) {
    const ahead = waiting.length + 1;
    await new Promise<void>((go, refuse) => {
      const mine = () => (clearTimeout(late), go());
      const late = setTimeout(() => (waiting.splice(waiting.indexOf(mine), 1), refuse(new Error(`${ahead + AT_ONCE - 1} looks were ahead of this one for ${WAIT_MS / 1000} s: ask again in a minute.`))), WAIT_MS);
      waiting.push(mine);
    });
  }
  drawing++;
  return () => (drawing--, waiting.shift()?.());
}

/** Draw `address` (the app's page in look mode, or a document's preview) at this size, once it has a turn. */
export async function drawLook(address: string, pass: string, width: number, height: number, scheme: 'dark' | 'light', marks = false, tries?: Try[]): Promise<Drawn> {
  const done = await turn();
  try {
    return await drawNow(address, pass, width, height, scheme, marks, tries);
  } finally {
    done();
  }
}

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|math|emoji|fangsong|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont)$/i;

/**
 * The face a family asks for, when it names one before any generic: the first named. Null for a family that starts
 * with a generic or the system's face, which asks for whatever the machine has.
 */
export function askedFace(family: string): string | null {
  const first = family.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? '';
  return first && !GENERIC.test(first) ? first : null;
}

/** Whether a face asked for was drawn in another: none of the faces Chrome used is it, and none is a web font of the page's own. */
export const fellBack = (asked: string, used: { familyName: string; isCustomFont?: boolean }[]) => used.length > 0 && !used.some((f) => f.isCustomFont || f.familyName.toLowerCase() === asked.toLowerCase());

/** The faces this page's text asked for that Chrome drew in another: one element read for each family the page uses. */
async function facesOf(tab: Tab): Promise<Drawn['fell_back']> {
  const families = await tab.evaluate<string[]>(`(async () => {
    await document.fonts.ready;
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (seen.size >= 40) break;
      if (![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
      const f = getComputedStyle(el).fontFamily;
      if (!seen.has(f)) (seen.add(f), el.setAttribute('data-look-face', String(seen.size - 1)));
    }
    return [...seen];
  })()`);
  const asking = families.map(askedFace);
  if (!asking.some(Boolean)) return undefined;
  await tab.send('DOM.enable');
  await tab.send('CSS.enable');
  const { root } = await tab.send('DOM.getDocument', { depth: 0 });
  const { nodeIds } = await tab.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-look-face]' });
  const out = new Map<string, string>();
  for (const nodeId of nodeIds as number[]) {
    const attrs: string[] = (await tab.send('DOM.getAttributes', { nodeId })).attributes;
    const asked = asking[Number(attrs[attrs.indexOf('data-look-face') + 1])];
    if (!asked || out.has(asked)) continue;
    const { fonts } = await tab.send('CSS.getPlatformFontsForNode', { nodeId });
    if (fellBack(asked, fonts)) out.set(asked, fonts.map((f: { familyName: string }) => f.familyName).join(', '));
  }
  return out.size ? [...out].map(([asked, drawn]) => ({ asked, drawn })) : undefined;
}

/** What a page's drawings say went wrong, as they show it (packs/walls/page/style-code.js, `lens-error`): the text of each shown. */
const SHOWN_ERRORS = `[...document.querySelectorAll('.lens-error')].filter((el) => !el.hidden && el.textContent.trim()).map((el) => el.textContent.trim())`;

/** A dry run's errors: what the page said, then each shown, each once; a drawing that never said it drew, said so. */
export function errorsOf(state: Drawn['state'], why: string | undefined, shown: string[]): string[] {
  const out = [...(state === 'error' || state === 'late') && why ? [why] : [], ...shown];
  return [...new Set(out.map((e) => e.slice(0, 300)))];
}

async function drawNow(address: string, pass: string, width: number, height: number, scheme: 'dark' | 'light', marks: boolean, tries?: Try[]): Promise<Drawn> {
  clearTimeout(idle);
  const began = Date.now();
  const tab = await (await getBrowser()).tab();
  // Past LATE_MS the tab is closed, which ends whatever command was waiting on it.
  const late = setTimeout(() => void tab.close(), LATE_MS);
  try {
    await tab.send('Page.enable');
    await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    // The page, and a style's code, take dark or light from the system's scheme: this one look's.
    await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    // The pass is the page's token for this one look: put where the page reads its token, before any of its code runs.
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('pelago-token', ${JSON.stringify(pass)}); } catch {}` });
    // A dry run's code, where the page's tries are read (packs/surface/page/preview.js) before its first drawing: data, never run here.
    if (tries?.length) await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `globalThis.lookTries = ${JSON.stringify(tries)};` });
    await tab.send('Page.navigate', { url: address });
    let said: { state?: string; why?: string } = {};
    for (const until = Date.now() + DRAW_MS; Date.now() < until; await wait(150)) {
      // Asked again until it answers: while the page loads there is nothing yet to ask.
      said = (await tab.evaluate<{ state?: string; why?: string }>(`({ state: document.documentElement.dataset.look, why: document.documentElement.dataset.look_why })`).catch(() => ({}))) ?? {};
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
    const made = marks && state === 'drawn' ? await tab.evaluate<Marks | null>('window.lookMarks()').catch(logged(`look ${address}: its marks could not be read`, null)) : null;
    const fell_back = await facesOf(tab).catch(logged(`look ${address}: its faces could not be read`));
    const drew = await tab.evaluate<unknown[] | null>('window.lookDrew ? window.lookDrew() : null').catch(logged(`look ${address}: what it drew with could not be read`, null));
    const why = state === 'late' ? `The view did not say it had drawn within ${DRAW_MS / 1000} s: this is how it stood.` : said.why;
    const errors = tries?.length ? errorsOf(state, why, (await tab.evaluate<string[]>(SHOWN_ERRORS).catch(logged(`look ${address}: its errors could not be read`, []))) ?? []) : undefined;
    return { data: jpeg ? await shot('jpeg') : last, content_type: jpeg ? 'image/jpeg' : 'image/png', width, height, state, ...(why && { why: why.slice(0, 300) }), settled, ms: Date.now() - began, ...(made && JSON.stringify(made).length <= MARKS_MOST && { marks: made }), ...(fell_back && { fell_back }), ...(drew?.length && { drew }), ...(errors && { errors }) };
  } catch (err) {
    throw Date.now() - began >= LATE_MS ? new Error(`The view had not drawn within ${LATE_MS / 1000} s, and its page stopped answering: it was closed.`) : err;
  } finally {
    clearTimeout(late);
    await tab.close();
    clearTimeout(idle);
    idle = setTimeout(async () => {
      // A browser that never started has nothing to close: its failure was the look's.
      const b = await browser?.catch(() => null);
      browser = null;
      b?.close();
    }, IDLE_MS);
    idle.unref();
  }
}

/** Stop the Chrome this process started, if any: for a server closing, and for tests. */
export async function stopLayout() {
  clearTimeout(idle);
  // A browser that never started has nothing to close: its failure was the look's.
  const b = await browser?.catch(() => null);
  browser = null;
  b?.close();
}
