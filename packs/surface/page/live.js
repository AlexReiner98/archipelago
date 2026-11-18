import { api, h, hooks, main, route, state } from './base.js';
import { follow as keepCurrent, Store, View } from './replica.js';
import { still } from './look.js';
import { hear, hearOpen, nameOf, sessionOf } from './pane-route.js';
import { onOpen } from './sessions-open.js';
import { numberOf } from './query-base.js';
import { islandsOn, keepList } from './islands-on.js';
import { relations, starterOf, types } from './words.js';

// ---- live updates --------------------------------------------------------

// The page reads the log forward (`tail`, packs/log/kernel/tail.ts): the facts after where it stands on
// what it holds. The page's one store (packs/surface/page/replica.js), shared by every view open on it, projects
// them itself; the sheet learns which of its items they touched. The page is drawn again, in place,
// only when one of them is on it, unless that would throw away something half done
// (typed text, ticked boxes, an open question, a graph being explored); then a notice
// offers the refresh instead. A change elsewhere on the map leaves the page still.
export let uiFiles;
export let outdated = false;

// Refresh throws away words not yet saved, so it asks first: the sheet's draft says so by name (packs/sheet/page/draft.js).
const refresh = async () => {
  if (!(await (hooks.mayLeave?.() ?? true))) return;
  return outdated ? location.reload() : route();
};
export const stale = h('div', { id: 'stale', hidden: true }, 'The map has changed.', h('button', { onclick: refresh }, 'Refresh'));
document.body.append(stale);
// Words typed and not yet saved hold the page; a dial, a tick or a pick is not unsaved work.
main.addEventListener('input', (e) => {
  if (e.target.matches?.('textarea, [contenteditable], input:not([type=range], [type=checkbox], [type=radio], [type=color])')) state.dirty = true;
});

// Agents on the page: what a session shows of an item on an island puts that island on the canvas and lights the item in
// the side bar, never moving the view (decision e_mnuthcap). Nothing else an agent does is said here: a change reaches
// the page from the log, a story is on its session's page (the owner, 30 Oct 2026).
/** This page, among the owner's open pages: the server counts those a show can land in, so an agent's show says whether it did. */
const pageId = Math.random().toString(36).slice(2, 14);
// A page the server draws for an agent's look is no page of the owner's: it is not counted. Any other takes a show.
// Where it stands goes with it, the page's address, so an agent knows what the owner is looking at (packs/presence/kernel/seeing.ts).
// The chats open now are heard too, so a show lit in the side bar is named by its chat's title.
onOpen(hearOpen);
const thisPage = () => (still ? undefined : { page: pageId, on: true, where: location.hash.slice(2, 2002) });
let seenStep;
/**
 * How long a step waits for a page to open, as the style says (show_waits_ms): one sent while none was (e_d8djfzmk)
 * lands when the next opens, within this. A style not yet read lets none wait.
 */
const waitsFor = () => {
  try {
    return numberOf(state.style ?? {}, 'show_waits_ms');
  } catch {
    return 0;
  }
};
/** The last step this browser followed on this map, kept so a reload does not land again what it landed before. */
const seenKey = `pelago-step-seen:${location.pathname}`;
const seenBefore = () => {
  try {
    return Number(localStorage.getItem(seenKey)) || 0;
  } catch {
    return 0;
  }
};

/** Islands shows asked on, put on the canvas by a page in sight only, so two of the owner's pages never write their list at once. */
const putting = new Map();
async function putOnShown() {
  if (document.visibilityState !== 'visible' || !putting.size) return;
  const asked = [...putting.entries()];
  putting.clear();
  const on = await islandsOn();
  const adding = asked.filter(([id]) => !on.includes(id));
  if (adding.length) await keepList([...on, ...adding.map(([id]) => id)], `${adding.map(([, why]) => why).join('; ')}: put on the canvas by a show`).catch((err) => console.warn(err.message));
}
addEventListener('visibilitychange', () => void putOnShown());
/** A show of an item on an island: the island on the canvas, the item lit in the side bar (the picker's lightIsland). */
function light(s) {
  const item = /^e\/(e_[a-z0-9]{8})(?:\?|$)/.exec(s.hash)?.[1] ?? s.island;
  putting.set(s.island, s.did || (s.title ?? s.actor ?? 'A session'));
  void putOnShown();
  hooks.lightIsland?.(s.island, item, nameOf(sessionOf(s)));
}

export function follow(steps = []) {
  // A look's page leaves what agents show to the owner's own pages.
  if (still) return;
  // The first answer follows what came while no page here was open, back to the last step this browser followed and
  // no further than the style lets a step wait; what is older only says where things stand.
  const since = seenStep ?? Math.max(seenBefore(), Date.now() - waitsFor());
  const fresh = steps.filter((s) => s.at > since);
  seenStep = steps.at(-1)?.at ?? seenStep ?? 0;
  try {
    localStorage.setItem(seenKey, String(Math.max(seenStep, seenBefore())));
  } catch {}
  for (const s of steps) hear(s);
  // What a session does may move its state, which the side bar and the band's count read (./sessions-open.js).
  if (fresh.some((s) => s.run)) hooks.sessionsMoved?.();
  // A beat told, or a session gone quiet, waiting or ended, moves its node on every canvas that draws it.
  const moved = [...new Set(fresh.filter((s) => s.run && (s.kind === 'story' || s.rests || s.ends)).map((s) => s.run))];
  if (moved.length) hooks.sessionsTold?.(moved);
  // A chat renamed is named anew in the side bar.
  if (fresh.some((s) => s.did === 'titled')) hooks.sessionsMoved?.();
  // A show never moves the view (decision e_mnuthcap): one of an item on an island puts its island on the canvas and
  // lights the item in the side bar. One of no island (a lens, a web page) leaves the page as it is.
  for (const s of fresh) if (s.kind === 'show' && s.hash && s.island) light(s);
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
  starterOf: (id) => (types.has(id) ? starterOf(id) : null),
  relationFamily: (...roots) => roots,
  shown: (type, field) => Boolean(types.get(type)?.fields?.[field]?.shown),
  phase: (type, status) => types.get(type)?.statuses?.phases?.[status],
  lineage: (type) => { const out = []; for (let t = types.get(type)?.flavour_of; t && !out.includes(t); t = types.get(t)?.flavour_of) out.push(t); return out; },
  flavour: (link) => { const out = []; for (let r = relations.get(link); r?.extends && !out.includes(r.extends); r = relations.get(r.extends)) out.push(r.extends); return out; },
};

/** The page's one store of items and links by id, shared by every view (the owner, 5 Nov 2026, e_5cdm9bfg). */
export const store = new Store(kinds);
/** The store by name, for a root before this one (packs/walls/page/layout-asks.js). */
hooks.store = () => store;

/**
 * A view of what `read` answers (a flat lens's answer, asked with `follow`), its rows in the page's one store and kept
 * current from the log from then on: the answer says where the log stood before the lens was read (`pos`), so nothing
 * said while it was read is missed, and nothing waits for a read of the log first. Stop with `unfollow` (packs/surface/page/replica.js).
 */
export async function replicate(read) {
  const view = new View(store);
  const [answer, held] = await Promise.all([read(), heldNow()]);
  // A look draws once and is closed: it is kept current from nothing.
  if (!still && !Number.isInteger(answer.pos)) throw new Error('A lens kept current is read with follow: true, so its answer says where the log stood');
  view.hold(answer, still ? undefined : answer.pos);
  holdNow(held);
  return keepCurrent(view);
}
/** The changes held for the owner, as this viewer may see them; none where they may not. */
const heldNow = () => api('proposals').catch(() => []);
/** The store holds what is held now, and the page is told (the call over the canvas, packs/write/page/item-held.js). */
const holdNow = (held) => (store.holdChanges(held), hooks.heldMoved?.(store.held));
/** Where the queue of held changes stood when the stores last read it. */
const heard = { queue: undefined };
/** The queue moved (a change held, applied or declined): the store reads what is held again. */
async function queueMoved(queue) {
  if (queue === heard.queue || !store.views.size) return;
  heard.queue = queue;
  holdNow(await heldNow());
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
  // A gate page (sign in, sign up, Allow) follows no map: asked signed out, each ask is refused and counted against the address.
  if (still || document.hidden || redrawing || document.body.dataset.gate) return;
  let now;
  let touched;
  let more = false;
  try {
    // From the furthest back of the page and its store, on everything it holds and the islands its views touch.
    const following = store.views.size > 0;
    const at = [state.pos, ...(following ? [store.pos] : [])].filter((pos) => pos !== undefined);
    const from = at.length ? Math.min(...at) : undefined;
    const ids = [...new Set([...shownIds(), ...(following ? store.ids() : [])])];
    const islands = following ? store.islands() : [];
    const beat = await api('tail', { ...(from === undefined ? { page: thisPage() } : { after: from, seq: state.seq, ids, ...(islands.length && { islands }), page: thisPage() }) });
    // Only an answer that read the facts moves the store: one that says only where the log stands would skip them.
    if (beat.entries && following) {
      try {
        store.apply(beat);
      } catch (err) {
        console.error(err);
      }
    }
    queueMoved(beat.queue).catch(() => {});
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
    // Or, on a guest map, that the page waits for the visitor's agent to write (packs/identity/page/guest.js).
    const awaiting = !beat.listening && hooks.awaiting?.();
    const ear = document.getElementById('listening');
    ear.hidden = !beat.listening && !awaiting;
    ear.textContent = awaiting || (beat.listening > 1 ? `${beat.listening} agents are listening` : 'An agent is listening');
    follow(beat.steps);
    // What changes touched, for whoever follows items as they are tied (ui/canvas.js).
    if (touched) hooks.touched?.(touched);
    if (touched?.made) hooks.made?.(touched);
  } catch {
    return;
  }
  const was = state.stamp;
  const moved = was !== undefined && now !== was;
  state.stamp = now;
  if (more) setTimeout(checkTail);
  if (!moved) return;
  // The map moved. What the page keeps of it between clicks (the parts, saved views, styles) needs no letting go: it is
  // kept with where the map stood, and the next ask of it has the new answer (packs/kit/page/reads.js).
  if (state.selfDrawn) return void (state.selfDrawn = false);
  // Only the map moved, and nothing of it is on the sheet: it stays as it is, and the canvas asks again if
  // it is on it (drawn again only where its answer changed).
  if (!bears(touched, now.split('.').slice(2).join() !== was.split('.').slice(2).join())) {
    for (const drawn of canvasViews()) {
      // A canvas whose answer is held in a store is kept current by the facts themselves (packs/surface/page/replica.js).
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
