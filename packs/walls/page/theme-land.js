// A theme's land (task e_vsxqy34d): the backdrop a style names (its `backdrop`: a layout a pack ships, the setup it is
// handed, and where it shows), run behind the app's page as a published page runs its own (./backdrop.js): walled in,
// in a sandboxed frame and its worker, told only the page's numbers and the boxes of its words.
//
// Where it shows is the page's state, read off the body: gate (sign in, sign up, Try it, and a new guest map's first
// card: every page before a workspace is in use), sheet (a sheet open over the map) and canvas (the map). It runs while
// the theme says the place it is in, and is taken away when the page leaves it; the page under it is see-through there
// (body[data-land], packs/surface/page/gate.css). Where it cannot run (no GPU, its code stopped) the page is as it was.
// Before a workspace the theme is the server's own (/connect/theme, as the gate's colours are), so the land runs on
// unbroken from Try it to a new guest map's first card; in a workspace, the workspace's.

import { onTheme } from './theme.js';
import { hooks } from './base.js';
import { runBackdrop } from './backdrop.js';

/** Which place the page is in now, as the body says. */
export function placeOf(body = document.body) {
  if (body.dataset.gate !== undefined || body.dataset.first === 'wait') return 'gate';
  return body.dataset.sheet === 'open' ? 'sheet' : 'canvas';
}

/**
 * Which gate page this is, as the theme's backdrop names its pages: its address's first word, sign-in for none; a new
 * guest map's first moments (Making your map, then the card) are Try it's, so its land runs on unbroken.
 */
export function pageOf(body = document.body, hash = location.hash) {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  if (body.dataset.first === 'wait' || (name === 'v' && body.dataset.gate !== undefined)) return 'try';
  return name || 'sign-in';
}

/** The land a style would run in a place: its backdrop when it shows there and has its drawing, else none. */
export function landFor(style, place) {
  const b = style?.backdrop;
  if (!(b && typeof b === 'object' && Array.isArray(b.on) && b.on.includes(place) && b.drawing?.hash)) return null;
  // At the gate, the page's own beat: its setup over the land's, and its still.
  const own = place === 'gate' ? b.pages?.[pageOf()] : undefined;
  return own ? { ...b, setup: { ...b.setup, ...own.setup }, still: own.still ?? b.still, ...(own.emblem && { emblem: own.emblem }) } : b;
}

/** A drawing's modules, kept by their hash once sent, so a style read again without them still runs. */
const kept = new Map();

let style = null, running = null;
const LESS_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
/** The still under a running land: its picture, shown at once and wherever the land cannot run. */
let still = null;
const STILL = /^(?:data:image\/(?:png|webp);base64,[A-Za-z0-9+/=]+|\/connect\/still\/(?:_|[a-z][a-z-]{0,30})\/(?:wide|narrow)\?v=[0-9a-f]{16})$/;

const EMBLEM = /^(?:data:image\/png;base64,[A-Za-z0-9+/=]+|\/connect\/still\/[a-z][a-z-]{0,30}\/emblem\?v=[0-9a-f]{16})$/;
/**
 * The emblem the land's page wears (its palette's), wherever the emblem shows while that land runs: the bar's mark and
 * the gate's (packs/surface/page/gate.css, body[data-land-emblem]); the theme's own again once it stops.
 */
function wearEmblem(land) {
  const url = land?.emblem;
  if (typeof url === 'string' && EMBLEM.test(url)) (document.body.style.setProperty('--emblem', `url("${url}")`), (document.body.dataset.landEmblem = ''));
  else (document.body.style.removeProperty('--emblem'), delete document.body.dataset.landEmblem);
}

/** The land's still put under its frame (before the map, so all of the page draws over it), or taken away with none. */
function layStill(land) {
  still?.remove();
  still = null;
  const s = land?.still;
  if (!s || !(STILL.test(s.wide ?? '') || STILL.test(s.narrow ?? ''))) return;
  still = document.createElement('div');
  still.className = 'land-still';
  still.setAttribute('aria-hidden', 'true');
  for (const k of ['wide', 'narrow']) if (STILL.test(s[k] ?? '')) still.style.setProperty(`--land-still-${k}`, `url("${s[k]}")`);
  document.body.insertBefore(still, document.getElementById('canvas'));
}
/** The server's own style, as the gate is painted in: asked once, when the page is first in the gate. */
let served;
const servedStyle = () => (served ??= (globalThis.pelagoEarly?.theme ?? fetch('/connect/theme').then((r) => (r.ok ? r.json() : null), () => null)).then((s) => ((served = s ?? null), again(), s)));

function wear() {
  const place = placeOf();
  if (place === 'gate' && served === undefined) return void servedStyle();
  const land = landFor(place === 'gate' ? (served instanceof Promise ? null : served) : style, place);
  if (land?.drawing.modules) kept.set(land.drawing.hash, land.drawing.modules);
  const code = land && kept.get(land.drawing.hash);
  // The same land in the same place runs on; a move between places it shows in keeps it running too.
  // Asked for less motion, a land with a still shows its still alone, and nothing runs.
  const calm = Boolean(code && land.still && LESS_MOTION.matches);
  const key = code ? `${calm ? 'still ' : ''}${land.drawing.hash} ${JSON.stringify(land.setup ?? {})} ${JSON.stringify(land.numbers ?? {})}` : '';
  if (running?.key === key) {
    if (key) document.body.dataset.land = place;
    return;
  }
  running?.stop();
  running = null;
  delete document.body.dataset.land;
  delete document.body.dataset.landDrew;
  layStill(code ? land : null);
  wearEmblem(code ? land : null);
  if (!code) return;
  document.body.dataset.land = place;
  if (calm) return void (running = { key, stop: () => undefined, still: true });
  const stop = runBackdrop({
    code,
    answer: { items: [], links: [] },
    style: { ...(land.setup && { setup: land.setup }), ...(land.numbers && { numbers: land.numbers }) },
    dressed: document.body,
    // Before the map, so the map, the sheet and the bars are drawn over it.
    under: document.getElementById('canvas'),
    // Drawn, and given its theme's time to gather: the still gives way to it.
    drew: () => ((document.body.dataset.landDrew = ''), setTimeout(() => running?.key === key && still?.classList.add('gone'), land.wait?.gather ?? 0)),
    failed: () => {
      if (running?.key !== key) return;
      // Where the land cannot run, its still stays and the page stands on it as on the land; kept as this land, so it
      // is not tried again until the theme or the place changes.
      still?.classList.remove('gone');
      running = { key, stop: () => undefined, still: true };
      delete document.body.dataset.landDrew;
      if (!still) delete document.body.dataset.land;
    },
  });
  running = { key, stop };
}

let soon = 0;
// A timer, not a frame: a page opened behind another tab gets no frames, and its land must be under way when it is shown.
const again = () => soon || (soon = setTimeout(() => ((soon = 0), wear())));

/**
 * Resolves once the land at the gate has drawn and been given its theme's time to gather (backdrop.wait.gather), or at
 * the most its theme waits (wait.most) from `since` (a time from performance.now()); at once where there is no land to
 * wait for. What the loading page (Making your map...) waits on, so the land is seen there before the page is entered.
 */
export function landShown(since) {
  return new Promise((done) => {
    const look = () => {
      // A still alone (less motion, or a land that cannot run): nothing to wait for.
      if (running?.still) return void done();
      const wait = served && !(served instanceof Promise) ? landFor(served, 'gate')?.wait : undefined;
      const left = since + (wait?.most ?? 0) - performance.now();
      if (wait && document.body.dataset.landDrew !== undefined) return void setTimeout(done, Math.max(0, Math.min(wait.gather ?? 0, left)));
      const none = served === null || (served && !(served instanceof Promise) && !landFor(served, 'gate'));
      if (none || (served && !(served instanceof Promise) && left <= 0)) return void done();
      setTimeout(look, 100);
    };
    look();
  });
}

/** Start wearing the theme's land: each style the page is painted in, and each move between places, is heard. */
export function startLand() {
  hooks.landShown = landShown;
  // Asked already where the page opens before a workspace (packs/surface/page/early.js): taken now, so the land starts at once.
  if (globalThis.pelagoEarly?.theme) servedStyle();
  onTheme((next) => ((style = next), again()));
  LESS_MOTION.addEventListener('change', again);
  // A new gate page opens on its own beat.
  addEventListener('hashchange', again);
  new MutationObserver(again).observe(document.body, { attributes: true, attributeFilter: ['data-gate', 'data-sheet', 'data-first'] });
}
