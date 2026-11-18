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
  // Sign up from the sign-in page passes through Try it (#/try?then=sign-up) on its way: it wears Sign up's land already.
  if (name === 'try' && /[?&]then=sign-up\b/.test(hash)) return 'sign-up';
  return name || 'sign-in';
}

/** The land a style would run in a place: its backdrop when it shows there and has its drawing, else none. */
export function landFor(style, place) {
  const b = style?.backdrop;
  if (!(b && typeof b === 'object' && Array.isArray(b.on) && b.on.includes(place) && b.drawing?.hash)) return null;
  // At the gate, the page's own beat: its setup over the land's.
  const own = place === 'gate' ? b.pages?.[pageOf()] : undefined;
  return own ? { ...b, setup: { ...b.setup, ...own.setup }, ...(own.emblem && { emblem: own.emblem }) } : b;
}

/** A drawing's modules, kept by their hash once sent, so a style read again without them still runs. */
const kept = new Map();

let style = null, running = null;
const LESS_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
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

/** The server's own style, as the gate is painted in: asked once, when the page is first in the gate. */
let served;
const servedStyle = () => (served ??= (globalThis.pelagoEarly?.theme ?? fetch('/connect/theme').then((r) => (r.ok ? r.json() : null), () => null)).then((s) => ((served = s ?? null), again(), s)));

function wear() {
  const place = placeOf();
  if (place === 'gate' && served === undefined) return void servedStyle();
  const land = landFor(place === 'gate' ? (served instanceof Promise ? null : served) : style, place);
  if (land?.drawing.modules) kept.set(land.drawing.hash, land.drawing.modules);
  const code = land && kept.get(land.drawing.hash);
  // The same land in the same place runs on; a move between places it shows in keeps it running too. No still picture
  // stands in for it (the owner, 17 Nov 2026: one showed through the land as it gathered): asked for less motion, or
  // where it cannot run, the page is left blank.
  const calm = Boolean(code && LESS_MOTION.matches);
  const key = code ? `${calm ? 'calm ' : ''}${land.drawing.hash} ${JSON.stringify(land.setup ?? {})} ${JSON.stringify(land.numbers ?? {})}` : '';
  if (running?.key === key) {
    if (key && !running.still) document.body.dataset.land = place;
    return;
  }
  // From one page's land to the next (sign in to sign up...): the one shown stays until the next has drawn and fades
  // in over it, so the page is never blank between them. Anything else is taken away at once.
  const crossing = Boolean(code && !calm && running && !running.still && running.place === place);
  if (crossing) leaving.push(running);
  else (running?.stop(), leaveAll());
  running = null;
  if (!crossing) (delete document.body.dataset.land, delete document.body.dataset.landDrew);
  wearEmblem(code ? land : null);
  if (!code) return;
  if (calm) return void (running = { key, stop: () => undefined, still: true });
  document.body.dataset.land = place;
  const stop = runBackdrop({
    code,
    answer: { items: [], links: [] },
    style: { ...(land.setup && { setup: land.setup }), ...(land.numbers && { numbers: land.numbers }) },
    dressed: document.body,
    // Before the map, so the map, the sheet and the bars are drawn over it.
    under: document.getElementById('canvas'),
    replace: false,
    drew: () => ((document.body.dataset.landDrew = ''), running?.key === key && leaveFaded()),
    failed: () => {
      if (running?.key !== key) return;
      leaveAll();
      // Where the land cannot run the page is blank; kept as this land, so it is not tried again until the theme or
      // the place changes.
      running = { key, stop: () => undefined, still: true };
      delete document.body.dataset.landDrew;
      delete document.body.dataset.land;
    },
  });
  running = { key, stop, place };
}

/** The lands a new one is fading in over: each taken away once it has (after `wait` ms), quietly, the new one's look kept. */
let leaving = [];
function leaveAll() {
  const going = leaving;
  leaving = [];
  going.forEach((l) => l.stop({ quiet: true }));
}
/** Once the newest land has faded in (its frame's opacity transition, packs/surface/page/gate.css), the rest go. */
function leaveFaded() {
  const frame = [...document.querySelectorAll('body > iframe.page-backdrop')].at(-1);
  const fades = frame && getComputedStyle(frame).transitionDuration.split(',').some((d) => parseFloat(d) > 0);
  if (!fades) return leaveAll();
  frame.addEventListener('transitionend', leaveAll, { once: true });
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
      // No land running (less motion, or a land that cannot run): nothing to wait for.
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
