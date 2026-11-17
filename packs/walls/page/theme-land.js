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

/** The land a style would run in a place: its backdrop when it shows there and has its drawing, else none. */
export function landFor(style, place) {
  const b = style?.backdrop;
  return b && typeof b === 'object' && Array.isArray(b.on) && b.on.includes(place) && b.drawing?.hash ? b : null;
}

/** A drawing's modules, kept by their hash once sent, so a style read again without them still runs. */
const kept = new Map();

let style = null, running = null;
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
  const key = code ? `${land.drawing.hash} ${JSON.stringify(land.setup ?? {})} ${JSON.stringify(land.numbers ?? {})}` : '';
  if (running?.key === key) {
    if (key) document.body.dataset.land = place;
    return;
  }
  running?.stop();
  running = null;
  delete document.body.dataset.land;
  delete document.body.dataset.landDrew;
  if (!code) return;
  document.body.dataset.land = place;
  const stop = runBackdrop({
    code,
    answer: { items: [], links: [] },
    style: { ...(land.setup && { setup: land.setup }), ...(land.numbers && { numbers: land.numbers }) },
    dressed: document.body,
    // Before the map, so the map, the sheet and the bars are drawn over it.
    under: document.getElementById('canvas'),
    drew: () => (document.body.dataset.landDrew = ''),
    failed: () => {
      if (running?.key !== key) return;
      running = null;
      delete document.body.dataset.land;
      delete document.body.dataset.landDrew;
    },
  });
  running = { key, stop };
}

let soon = 0;
// A timer, not a frame: a page opened behind another tab gets no frames, and its land must be under way when it is shown.
const again = () => soon || (soon = setTimeout(() => ((soon = 0), wear())));

/** How long the land is given, once drawn, to gather before a page that waits for it moves on. */
const GATHER_MS = 2200;

/**
 * Resolves once the land at the gate has drawn and had a moment to gather, or at `by` (a time from performance.now())
 * at the latest; at once where there is no land to wait for. What the loading page (Making your map...) waits on, so
 * the land is seen there before the page is entered.
 */
export function landShown(by) {
  return new Promise((done) => {
    const look = () => {
      const left = by - performance.now();
      if (document.body.dataset.landDrew !== undefined) return void setTimeout(done, Math.max(0, Math.min(GATHER_MS, left)));
      const none = served === null || (served && !(served instanceof Promise) && !landFor(served, 'gate'));
      if (left <= 0 || none) return void done();
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
  new MutationObserver(again).observe(document.body, { attributes: true, attributeFilter: ['data-gate', 'data-sheet', 'data-first'] });
}
