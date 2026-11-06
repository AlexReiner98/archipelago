import { api, h, state } from './base.js';
import { changeSet, touched as marked } from './changes.js';
import { before, rowsAt, stepsOf } from './catch-up-steps.js';
import { project } from './project.js';
import { numberOf } from './query-base.js';
import { trace, whoami, whoSaid } from './traces.js';
import { sessionHue } from './words.js';

// ---- catch-up: since you last looked, played ------------------------------------
//
// Where the log stood when the person last looked is kept in this browser, for each workspace, as the traces are
// (ui/traces.js). A page opened later holds the map as it is now; what changed between the two positions on the
// canvas it opens on is worked out from the log (the facts since, and every fact said of what is drawn up to then,
// folded by the projector into what it was: src/tail.ts) and traced until seen, as a change that comes while the page
// is open is. Play takes the canvas back to where the person left it and replays the log from there through its
// store (ui/replica.js), a step at a time, so each is a scene the transition engine moves into (ui/transition.js):
// chapters by who made them, each played island by island. Every time and count is the style's (`catch_up_*`).
// What left the canvas while it was closed is not among what it holds, and so is not played.

/** Where the log stood when the person last looked here, as kept before this page opened: read once. */
const since = whoami().then((me) => {
  try {
    const v = Number(localStorage.getItem(keyOf(me.ws)));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
});
const keyOf = (ws) => `pelago-looked-${ws ?? 'default'}`;

/** The person has looked at the map as it stands at `pos`: kept for the next time a page opens. Only while it is in sight. */
export function looked(pos) {
  if (document.hidden || pos === undefined) return;
  since.then(() => whoami()).then((me) => {
    try {
      localStorage.setItem(keyOf(me.ws), String(pos));
    } catch {
      // Without storage a page opened later has nothing to catch up from.
    }
  });
}

/** The catch-up a canvas offers, once a page: its store, what it was, and the steps from there. */
let offered = null;
let tried = false;

/**
 * Catch a canvas up (ui/canvas.js, the first it draws on a page): what changed on its store since the person last
 * looked is traced, and offered to play.
 */
export async function catchUp(store) {
  if (tried || !store) return;
  tried = true;
  const from = await since;
  if (from === undefined || !(from < store.pos)) return;
  const most = numberOf(state.style, 'catch_up_entries_most');
  // The facts since, on what the store holds, up to where the store stands; what comes after it is the live beat's.
  const entries = [];
  let gone = [];
  for (let after = from; after < store.pos; ) {
    const beat = await api('tail', { after, ids: store.ids() });
    entries.push(...(beat.entries ?? []).filter((e) => e.pos <= store.pos));
    gone = [...gone, ...(beat.gone ?? [])];
    if (entries.length > most) return;
    if (!beat.more || beat.pos <= after) break;
    after = beat.pos;
  }
  if (!entries.length) return;
  const touched = [...new Set(entries.flatMap((e) => e.facts.map((f) => f[1])))];
  const { was } = await api('tail', { was: from, ids: touched });
  const { kinds } = store;
  const then = before(store, rowsAt(kinds, was.entries), entries);
  trace(changeSet(then, kinds, entries, { after: from, gone })).catch(() => {});
  const me = await whoami();
  const steps = stepsOf(kinds, then, entries, me.actor);
  if (!steps.length) return;
  offered = { store, then, steps, to: store.pos };
  // How many items it changed, as a count; playing, which step of how many.
  band(`${new Set(steps.flatMap((s) => [...marked(s.set).keys()])).size} changed`);
}

// ---- the player: a band over the canvas -----------------------------------------------

const count = h('span', { class: 'cu-count' });
const who = h('span', { class: 'cu-who' });
const playButton = h('button', { title: 'Play what changed since you last looked, a step at a time', onclick: () => play() }, 'Play');
const skip = h('button', { class: 'cu-skip', title: 'The map as it is now', onclick: () => end() }, 'Skip');
const shut = h('button', { class: 'cu-shut', title: 'Leave it: what changed stays traced', onclick: () => ((offered = null), (bar.hidden = true)) }, '×');
const bar = h('div', { id: 'catch-up', hidden: true, title: 'What changed since you last looked' }, count, who, playButton, skip, shut);
document.body.append(bar);

function band(n) {
  count.textContent = n;
  who.textContent = '';
  bar.classList.remove('playing');
  bar.hidden = false;
}

let timer = 0;
/** Back to where the person left it, then each step in turn, each a scene the canvas moves into. */
function play() {
  const o = offered;
  if (!o || o.store.playing) return;
  const { store, then, steps } = o;
  if (!store.listeners.size) return ((offered = null), (bar.hidden = true));
  // The live beat leaves a store being played alone (ui/live.js); it catches up from where the play ends.
  store.playing = true;
  store.items = new Map(then.items);
  store.links = new Map(then.links);
  o.played = 0;
  bar.classList.add('playing');
  store.tell(nothing());
  const next = () => {
    if (offered !== o || o.played >= steps.length) return end();
    const s = steps[o.played++];
    // Several steps can come from one entry (its islands, in turn): each is projected at its position, once.
    store.pos = s.pos - 0.5;
    store.apply({ pos: s.pos, entries: [s] });
    count.textContent = `${o.played} of ${steps.length}`;
    who.textContent = whoSaid(s.by);
    who.style.setProperty('--trace-hue', sessionHue(s.by?.word ?? '') ?? 'var(--accent)');
    timer = setTimeout(next, numberOf(state.style, 'catch_up_step'));
  };
  timer = setTimeout(next, numberOf(state.style, 'catch_up_start'));
}

/** The map as it is now: what was not played yet projected at once, the store where it stood, and the band gone. */
function end() {
  clearTimeout(timer);
  const o = offered;
  offered = null;
  bar.hidden = true;
  if (!o?.store.playing) return;
  const { store, steps, to } = o;
  for (const s of steps.slice(o.played ?? 0)) project(store, store.kinds, s.at, s.facts);
  store.pos = to;
  store.playing = false;
  store.tell(nothing());
}

const nothing = () => ({ items: { added: [], changed: [], removed: [] }, links: { added: [], changed: [], removed: [] }, missing: [] });

/** The catch-up offered, for a test: how many steps, and whether it plays. */
export const caughtUp = () => (offered ? { steps: offered.steps.length, playing: Boolean(offered.store.playing), to: offered.to } : null);
