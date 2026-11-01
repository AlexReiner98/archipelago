import { api, h, hooks, main, route, state } from './base.js';
import { follow as keepCurrent, followed as kept, Replica } from './replica.js';
import { lookMode } from './look.js';
import { hear, sessionOf } from './pane-route.js';
import { poppedTab, tabs } from './tabs.js';
import { types } from './words.js';

// ---- live updates --------------------------------------------------------

// The page reads the log forward (`tail`, src/tail.ts): the facts after where it stands on
// what it holds. A store that holds a lens's answer (ui/replica.js) projects them itself; the
// sheet learns which of its items they touched. The page is drawn again, in place,
// only when one of them is on it, unless that would throw away something half done
// (typed text, ticked boxes, an open question, a graph being explored); then a notice
// offers the refresh instead. A change elsewhere on the map leaves the page still.
export let uiFiles;
export let outdated = false;
export const stale = h('div', { id: 'stale', hidden: true }, 'The map has changed.', h('button', { onclick: () => (outdated ? location.reload() : route()) }, 'Refresh'));
document.body.append(stale);
// Words typed and not yet saved hold the page; a dial, a tick or a pick is not unsaved work.
main.addEventListener('input', (e) => {
  if (e.target.matches?.('textarea, [contenteditable], input:not([type=range], [type=checkbox], [type=radio], [type=color])')) state.dirty = true;
});

// Agents on the page: what a session shows lands in a pane of its own, or a tab of its own, and the pane's strip or the
// tab's mark says so; where is ui/pane-route.js. Nothing else an agent does is said here: a change reaches the page from
// the log, a story is on its session's page (the owner, 30 Oct 2026).
/** This page, among the owner's open pages: the server counts those a show can land in, so an agent's show says whether it did. */
const pageId = Math.random().toString(36).slice(2, 14);
// A page the server draws for an agent's look is no page of the owner's: it is not counted. Every tab following nobody takes no show.
const thisPage = () => (lookMode ? undefined : { page: pageId, on: tabs.list.some((t) => t.follows !== 'none') });
let seenStep;
/** Each session's last show not yet landed: it waits while a question is open over the page. */
const waiting = new Map();

export function follow(steps = []) {
  // A look's page, and a popped-out tab, leave what agents show to the main page.
  if (lookMode || poppedTab) return;
  // The first answer only says where things stand; an old step is not followed.
  const fresh = seenStep === undefined ? [] : steps.filter((s) => s.at > seenStep);
  seenStep = steps.at(-1)?.at ?? seenStep ?? 0;
  for (const s of steps) hear(s);
  // A later show takes the place of what waits, and its tab of its own, if it was owed one, stays owed.
  for (const s of fresh) if (s.kind === 'show' && s.hash) waiting.set(sessionOf(s), { ...s, opens: s.opens || waiting.get(sessionOf(s))?.opens });
  if (!hooks.land || document.querySelector('dialog[open]')) return;
  for (const s of waiting.values()) hooks.land(s);
  waiting.clear();
}

/** The items the sheet shows: what it is the page of, what it names or links to, and what its views hold. */
export function shownIds() {
  const ids = new Set(location.hash.match(/e_[a-z0-9]{8}/g) ?? []);
  for (const a of main.querySelectorAll('a[href*="e_"]')) for (const id of a.getAttribute('href').match(/e_[a-z0-9]{8}/g) ?? []) ids.add(id);
  for (const n of main.querySelectorAll('[data-root], [data-item]')) ids.add(n.dataset.root ?? n.dataset.item);
  for (const host of main.querySelectorAll('.lens-wrap')) for (const item of host.answer?.items ?? []) ids.add(item.id);
  return ids;
}
/** The canvases behind the sheet (ui/canvas.js): the view each pane draws. */
const canvasViews = () => document.querySelectorAll('#canvas > .pane > .pane-canvas > .lens-wrap');

/** What the projector asks of the types, read from the schema the page loaded; and which fields a lens sends. */
export const kinds = {
  isOpen: (type, status) => types.get(type)?.statuses?.open?.includes(status) ?? true,
  type: (id) => types.get(id),
  relationFamily: (...roots) => roots,
  shown: (type, field) => Boolean(types.get(type)?.fields?.[field]?.shown),
};

/**
 * A store holding what `read` answers (a flat lens's answer), kept current from the log from then on: where the log
 * stands is read first, so nothing said while the lens is read is missed. Stop with `unfollow` (ui/replica.js).
 */
export async function replicate(read) {
  // A look draws once and is closed: it is kept current from nothing (and tail is the owner's page's, not an agent's).
  const { pos, queue } = lookMode ? {} : await api('tail', {});
  const store = new Replica(kinds);
  const [answer, held] = await Promise.all([read(), heldNow()]);
  store.hold(answer, pos);
  store.holdChanges(held);
  heard.queue ??= queue;
  return keepCurrent(store);
}
/** The changes held for the owner, as this viewer may see them; none where they may not. */
const heldNow = () => api('proposals').catch(() => []);
/** Where the queue of held changes stood when the stores last read it. */
const heard = { queue: undefined };
/** Read the log and what is held again now, not at the next beat: after the person decided or made something here. */
export async function heldAgain() {
  await checkTail();
  const held = await heldNow();
  for (const store of kept) store.holdChanges(held);
}
/** The queue moved (a change held, applied or declined): every store reads what is held again. */
async function queueMoved(queue, stores) {
  if (queue === heard.queue || !stores.length) return;
  heard.queue = queue;
  const held = await heldNow();
  for (const store of stores) store.holdChanges(held);
}

/** Whether what changed (the items facts and events touched, and whether the held changes or a story moved) bears on the page in view. */
export function bears(touched, queueMoved) {
  if (!touched || touched.ids === null) return true;
  // A list or a screen may hold an item just made; Home holds what waits for the owner.
  if (/^#\/(map|s\/)/.test(location.hash) && touched.made) return true;
  if (queueMoved && (!/^#\/e\//.test(location.hash) || main.querySelector('.story'))) return true;
  const ids = shownIds();
  return touched.ids.some((id) => ids.has(id));
}

/** The items the facts after `pos` and the other events touched: both ends of a link; null when the read stopped short. */
function touchedBy(beat, pos) {
  if (beat.more) return { ids: null, made: beat.made };
  const ids = new Set([...(beat.events ?? []), ...(beat.gone ?? [])]);
  for (const e of beat.entries ?? []) if (e.pos > pos) for (const f of e.facts) for (const id of f[2] === 'link' && f[0] === '+' ? f[3].slice(1) : [f[1]]) ids.add(id);
  return { ids: [...ids], made: beat.made ?? 0 };
}

/** A redraw under way: another is not started on top of it. */
export let redrawing = false;
export async function checkTail() {
  if (lookMode || document.hidden || redrawing) return;
  let now;
  let touched;
  let more = false;
  try {
    // From the furthest back of the page and its stores, on everything any of them holds.
    const stores = [...kept];
    const at = [state.pos, ...stores.map((s) => s.pos)].filter((pos) => pos !== undefined);
    const from = at.length ? Math.min(...at) : undefined;
    const ids = [...new Set([...shownIds(), ...stores.flatMap((s) => s.ids())])];
    const beat = await api('tail', { ...(from === undefined ? { page: thisPage() } : { after: from, seq: state.seq, ids, page: thisPage() }) });
    // Only an answer that read the facts moves a store: one that says only where the log stands would skip them.
    if (beat.entries) for (const store of stores) {
      try {
        store.apply(beat);
      } catch (err) {
        console.error(err);
      }
    }
    queueMoved(beat.queue, stores).catch(() => {});
    touched = state.pos === undefined ? undefined : touchedBy(beat, state.pos);
    now = `${beat.pos}.${beat.seq}.${beat.queue}`;
    state.pos = beat.pos;
    state.seq = beat.seq;
    more = Boolean(beat.more);
    // The page's own files changed on the server: load them, unless that would
    // throw away something half done.
    if (uiFiles !== undefined && beat.ui !== uiFiles) {
      if (!state.dirty && !document.querySelector('dialog[open]')) return location.reload();
      outdated = true;
      stale.firstChild.textContent = 'Archipelago has been updated.';
      stale.hidden = false;
    }
    uiFiles ??= beat.ui;
    // Whether an agent will hear what is done here the moment it is done.
    const ear = document.getElementById('listening');
    ear.hidden = !beat.listening;
    ear.textContent = beat.listening > 1 ? `${beat.listening} agents are listening` : 'An agent is listening';
    follow(beat.steps);
    // What changes touched, for whoever follows items as they are tied (ui/canvas.js).
    if (touched) hooks.touched?.(touched);
  } catch {
    return;
  }
  const was = state.stamp;
  const moved = was !== undefined && now !== was;
  state.stamp = now;
  if (more) setTimeout(checkTail);
  if (!moved) return;
  if (state.selfDrawn) return void (state.selfDrawn = false);
  // Only the map moved, and nothing of it is on the sheet: it stays as it is, and the canvas asks again if
  // it is on it (drawn again only where its answer changed).
  if (!bears(touched, now.split('.').slice(2).join() !== was.split('.').slice(2).join())) {
    for (const drawn of canvasViews()) {
      // A canvas whose answer is held in a store is kept current by the facts themselves (ui/replica.js).
      if (drawn.store) continue;
      if (!touched || touched.ids === null || touched.made || touched.ids.some((id) => drawn.answer?.items.some((i) => i.id === id))) drawn.refresh?.();
    }
    return;
  }
  if (state.dirty || document.querySelector('dialog[open]') || /^#\/new/.test(location.hash)) {
    stale.hidden = false;
    return;
  }
  // Hold the page's height while it is redrawn, so the scroll position stays: an item's page swaps only what changed.
  main.style.minHeight = `${main.offsetHeight}px`;
  redrawing = true;
  try {
    await route(true);
  } finally {
    redrawing = false;
  }
  setTimeout(() => (main.style.minHeight = ''), 1000);
}
setInterval(checkTail, 2000);
document.addEventListener('visibilitychange', checkTail);
