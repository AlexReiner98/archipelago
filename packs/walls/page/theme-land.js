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

/** The land the page would wear where it is now, and its key; undefined while the gate's style is still being asked. */
function target() {
  const place = placeOf();
  if (place === 'gate' && served === undefined) return void servedStyle();
  const land = landFor(place === 'gate' ? (served instanceof Promise ? null : served) : style, place);
  if (land?.drawing.modules) kept.set(land.drawing.hash, land.drawing.modules);
  const code = land && kept.get(land.drawing.hash);
  // No still picture stands in for it (the owner, 17 Nov 2026: one showed through the land as it gathered): asked for
  // less motion, or where it cannot run, the page is left blank.
  const calm = Boolean(code && LESS_MOTION.matches);
  // Its emblem is its page's palette: two pages of one setup but not one palette are two lands.
  const key = code ? `${calm ? 'calm ' : ''}${land.drawing.hash} ${JSON.stringify(land.setup ?? {})} ${JSON.stringify(land.numbers ?? {})} ${land.emblem ?? ''}` : '';
  // From one page's land to the next (sign in to sign up...): the one shown is let go first.
  const turns = Boolean(code && !calm && running && !running.still && running.place === place && running.key !== key);
  return { place, land, code, calm, key, turns };
}

function wear() {
  // A land dissipating is let go whole before anything else runs: it is worn again once it has.
  if (going) return;
  const t = target();
  if (!t) return;
  // The same land in the same place runs on; a move between places it shows in keeps it running too.
  if (running?.key === t.key) {
    if (t.key && !running.still) document.body.dataset.land = t.place;
    return;
  }
  // The one shown dissipates and is stopped, its palette with it, and only then is the next shown, from nothing, in
  // its own palette and emblem. Anything else goes at once.
  if (t.turns) return void letGo(running, t);
  running?.stop();
  running = null;
  delete document.body.dataset.land;
  delete document.body.dataset.landDrew;
  wearEmblem(t.code ? t.land : null);
  if (!t.code) return;
  if (t.calm) return void (running = { key: t.key, stop: () => undefined, still: true });
  document.body.dataset.land = t.place;
  running = start(t);
}

/** A land run: shown, or `held` out of sight while the last one goes, so it has started by the time it is shown. */
function start({ land, code, key, place }, held = false) {
  const run = { key, place, drew: false };
  run.stop = runBackdrop({
    code,
    answer: { items: [], links: [] },
    style: { ...(land.setup && { setup: land.setup }), ...(land.numbers && { numbers: land.numbers }) },
    dressed: document.body,
    // Before the map, so the map, the sheet and the bars are drawn over it.
    under: document.getElementById('canvas'),
    replace: !held,
    held,
    drew: () => ((run.drew = true), running === run && (document.body.dataset.landDrew = ''), run.onDrew?.()),
    failed: () => {
      if (running !== run) return void ((run.failed = true), run.onDrew?.());
      // Where the land cannot run the page is blank; kept as this land, so it is not tried again until the theme or
      // the place changes.
      running = { key, stop: () => undefined, still: true };
      delete document.body.dataset.landDrew;
      delete document.body.dataset.land;
    },
  });
  return run;
}

/** The land dissipating between two pages, until it is gone: `done` resolves once the next has been put on. */
let going = null;
/**
 * Let a land go by its own motion: its code is told the page is leaving (page.leaving: backdrop.js) and given the
 * theme's time for it (backdrop.wait.leave, in ms), then stopped, its palette with it. The next page's land (`next`)
 * starts out of sight meanwhile, so it is under way the moment it is shown, with its emblem. Not faded: what is seen
 * is the pattern dissolving. One not yet drawn, or a theme that gives no time, goes at once.
 */
function letGo(land, next) {
  let finish;
  going = { land, done: new Promise((r) => (finish = r)) };
  running = null;
  const wait = document.body.dataset.landDrew !== undefined && served && !(served instanceof Promise) ? landFor(served, 'gate')?.wait : undefined;
  const ms = wait?.leave ?? 0;
  const early = ms > 0 && land.stop.leave && next?.code && !next.calm ? start(next, true) : null;
  const done = () => {
    land.stop();
    going = null;
    // The page moved on again meanwhile, or the next one could not run: worn afresh for where the page is now.
    if (!early || early.failed || target()?.key !== early.key) {
      early?.stop();
      delete document.body.dataset.land;
      delete document.body.dataset.landDrew;
      wear();
      return void finish();
    }
    running = early;
    wearEmblem(next.land);
    document.body.dataset.land = next.place;
    if (early.drew) document.body.dataset.landDrew = '';
    else delete document.body.dataset.landDrew;
    early.stop.show();
    finish();
  };
  // The page changes when the last land has gone and the next has its first picture, so words, emblem and land come
  // together; the next is waited for at most the theme's wait.ready (ms) more.
  const ready = () => {
    if (!early || early.drew || early.failed || !(wait?.ready > 0)) return done();
    const once = () => ((early.onDrew = undefined), clearTimeout(cap), done());
    const cap = setTimeout(once, wait.ready);
    early.onDrew = once;
  };
  if (!(ms > 0) || !land.stop.leave) return void done();
  land.stop.leave();
  setTimeout(ready, ms);
}

/**
 * Before a gate page is drawn (packs/kit/page/base.js gate): where its land is not the one shown, the one shown is let
 * go first, and the page waits on it, so its words and emblem change together, as its own land comes in.
 * Null where there is nothing to wait for.
 */
export function landTurn() {
  if (going) return going.done;
  const t = target();
  if (!t?.turns) return null;
  // The next page's emblem is fetched while the last land goes, so it is there the moment the page changes.
  if (typeof t.land.emblem === 'string' && EMBLEM.test(t.land.emblem)) new Image().src = t.land.emblem;
  letGo(running, t);
  return going?.done ?? null;
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
  hooks.landTurn = landTurn;
  // Asked already where the page opens before a workspace (packs/surface/page/early.js): taken now, so the land starts at once.
  if (globalThis.pelagoEarly?.theme) servedStyle();
  onTheme((next) => ((style = next), again()));
  LESS_MOTION.addEventListener('change', again);
  // A new gate page opens on its own beat.
  addEventListener('hashchange', again);
  new MutationObserver(again).observe(document.body, { attributes: true, attributeFilter: ['data-gate', 'data-sheet', 'data-first'] });
}
