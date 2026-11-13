import { api, h, hooks, main, route, state, whoami } from './base.js';
import { project } from './project.js';
import { beatRows, missedRows } from './beat-rows.js';
import { follow as keepCurrent, Store, View } from './replica.js';
import { still } from './look.js';
import { hear, sessionOf } from './pane-route.js';
import { numberOf } from './query-base.js';
import { front, landsIn, poppedTab } from './tabs.js';
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

// ---- what changed, handed to the trace overlay as data (the slot `traces`, the catch_up pack's parts) -------------
//
// The runtime holds the store and the projector (packs/log/kernel/project.ts); the parts decide what a change was and
// what to trace or play. So each beat is told as the rows it touched, as they stood before it and after, projected on
// a copy (the store itself is never moved here), with the maker of the last entry that touched each.

const rowOf = (held, id) => (id.startsWith('r_') ? held.links : held.items).get(id) ?? null;
/** The rows `entries` touch in `held` ({ items, links }), as they were and are, each with its latest maker; `gone` left. Answers the rows and the copy as it ends. */
function rowsOf(held, kinds, entries, gone = []) {
  const now = { items: new Map(held.items), links: new Map(held.links) };
  const first = new Map();
  const last = new Map();
  const note = (id) => first.has(id) || first.set(id, rowOf(now, id));
  for (const e of entries) {
    for (const f of e.facts) {
      note(f[1]);
      if (f[2] === 'forgotten') for (const [rid, r] of now.links) if (r.from_id === f[1] || r.to_id === f[1]) note(rid);
    }
    const moved = project(now, kinds, e.at, e.facts, Boolean(e.moved));
    for (const id of [...moved.items, ...moved.links, ...moved.gone]) last.set(id, { ...(e.by && { by: e.by }), at: e.at, pos: e.pos });
  }
  for (const id of gone) if (rowOf(now, id)) (note(id), now.items.delete(id), now.links.delete(id));
  const to = Math.max(0, ...entries.map((e) => e.pos));
  return { rows: [...first].map(([id, was]) => ({ id, was, now: rowOf(now, id), ...(last.get(id) ?? { pos: to }) })), now };
}

/** Where the log stood when the person last looked, kept in this browser for each workspace: read once, as the page opens. */
const lookedKey = whoami().then((j) => `pelago-looked-${j?.workspace?.id ?? 'default'}`, () => 'pelago-looked-default');
const lookedAt = lookedKey.then((k) => {
  try {
    const v = Number(localStorage.getItem(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
});
/** The person has looked at the map as it stands at `pos`: kept for the next page, only while it is in sight. */
function looked(pos) {
  if (document.hidden || pos === undefined) return;
  lookedAt.then(() => lookedKey).then((k) => {
    try {
      localStorage.setItem(k, String(pos));
    } catch {
      // Without storage a page opened later has nothing to catch up from.
    }
  });
}

/** What a view held before `entries`, from what it holds now and every fact said of their rows up to then (`was`). */
function rowsBefore(view, kinds, was, entries) {
  const at = { items: new Map(), links: new Map() };
  for (const e of was) project(at, kinds, e.at, e.facts);
  const out = { items: new Map(view.items), links: new Map(view.links) };
  const made = new Set(entries.flatMap((e) => e.facts.filter((f) => f[0] === '+' && (f[2] === 'type' || f[2] === 'link')).map((f) => f[1])));
  for (const e of entries) for (const f of e.facts) {
    const key = f[1].startsWith('r_') ? 'links' : 'items';
    const row = at[key].get(f[1]);
    const held = view[key];
    if (row && held.has(f[1])) out[key].set(f[1], held.get(f[1])?.session ? { ...row, session: held.get(f[1]).session } : row);
    else if (made.has(f[1])) out[key].delete(f[1]);
  }
  return out;
}

let missedTold = false;
/**
 * Tell the trace overlay what changed on a canvas's store since the person last looked, once a page: the whole span
 * as a beat (traced until seen), and each entry with its rows (`missed`, played by catch_up.replay). The view's store
 * keeps where it was (`store.missed`), so a replay mark can take it back there.
 */
export async function tellMissed(view) {
  if (missedTold || !view?.store) return;
  missedTold = true;
  const from = await lookedAt;
  const to = view.pos;
  if (from === undefined || !(from < to)) return;
  const most = numberOf(state.style, 'catch_up_entries_most');
  const ids = [...view.ids, ...view.links.keys()];
  const entries = [];
  let gone = [];
  for (let after = from; after < to; ) {
    const beat = await api('tail', { after, ids });
    entries.push(...(beat.entries ?? []).filter((e) => e.pos <= to));
    gone = [...gone, ...(beat.gone ?? [])];
    if (entries.length > most) return;
    if (!beat.more || beat.pos <= after) break;
    after = beat.pos;
  }
  if (!entries.length) return;
  const touched = [...new Set(entries.flatMap((e) => e.facts.map((f) => f[1])))];
  const { was } = await api('tail', { was: from, ids: touched });
  const { kinds } = view;
  const then = rowsBefore(view, kinds, was.entries ?? [], entries);
  view.store.missed = { view, then, entries, from, to };
  hooks.tellSlot?.('traces', { name: 'beat', from, to, rows: rowsOf(then, kinds, entries, gone).rows });
  let at = then;
  const each = entries.map((e) => {
    const { rows, now } = rowsOf(at, kinds, [e]);
    at = now;
    return { pos: e.pos, at: e.at, by: e.by, ...(e.moved && { moved: e.moved }), facts: e.facts, rows: rows.map(({ id, was, now }) => ({ id, was, now })) };
  });
  const islands = Object.fromEntries([...then.items].map(([id, r]) => [id, r.props?.island ?? '']));
  hooks.tellSlot?.('traces', { name: 'missed', from, to, entries: each, islands });
}
// The canvas asks for it by name (packs/surface/page/canvas.js), never by importing this file.
hooks.tellMissed = tellMissed;
// Refresh throws away words not yet saved, so it asks first (ui/draft.js); loaded when clicked, as draft.js reaches
// this module through the canvas and a static import would close the loop.
const refresh = async () => {
  if (!(await (await import('./draft.js')).mayLeave())) return;
  return outdated ? location.reload() : route();
};
export const stale = h('div', { id: 'stale', hidden: true }, 'The map has changed.', h('button', { onclick: refresh }, 'Refresh'));
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
// A page the server draws for an agent's look is no page of the owner's: it is not counted. Any other takes a show: a
// chat with no tab here is opened one. Where it stands goes with it: the address of the pane in focus, and the chat whose
// tab is in sight, so an agent knows what the owner is looking at and whether it is its own tab (packs/presence/kernel/seeing.ts). A
// popped-out tab is the main page's too.
const thisPage = () => {
  if (still) return undefined;
  const t = front();
  const chat = t?.chat ?? (/^e_[a-z0-9]{8}$/.test(t?.follows ?? '') ? t.follows : undefined);
  const lands = landsIn(t);
  return { page: pageId, on: true, where: location.hash.slice(2, 2002), ...(chat && { tab: { chat, own: Boolean(t.chat) } }), ...(lands.length && { lands }) };
};
let seenStep;
/** Each session's last show not yet landed: it waits while a question is open over the page, or the reader is busy in its tab. */
const waiting = new Map();
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

export function follow(steps = []) {
  // A look's page, and a popped-out tab, leave what agents show to the main page.
  if (still || poppedTab) return;
  // The first answer follows what came while no page here was open, back to the last step this browser followed and
  // no further than the style lets a step wait; what is older only says where things stand.
  const since = seenStep ?? Math.max(seenBefore(), Date.now() - waitsFor());
  const fresh = steps.filter((s) => s.at > since);
  seenStep = steps.at(-1)?.at ?? seenStep ?? 0;
  try {
    localStorage.setItem(seenKey, String(Math.max(seenStep, seenBefore())));
  } catch {}
  for (const s of steps) hear(s);
  // What a session does may move its state, which the tab bar counts (ui/tab-bar.js).
  if (fresh.some((s) => s.run)) hooks.sessionsMoved?.();
  // A chat that ended closes its tab here (ui/tab-life.js).
  // The part on `tabs` is told the same, as data (hooks.tellSlot, packs/surface/page/part-host.js), where one is mounted.
  for (const s of fresh) if (s.ends && s.run) (hooks.sessionEnded?.(s.run, s.did), hooks.tellSlot?.('tabs', { name: 'ended', run: s.run, why: s.did ?? null }));
  // One gone quiet or waiting lets its tab go too, until it next shows something.
  for (const s of fresh) if (s.rests && s.run) (hooks.sessionRested?.(s.run), hooks.tellSlot?.('tabs', { name: 'rested', run: s.run }));
  // A beat told, or a session gone quiet, waiting or ended, moves its node on every canvas that draws it.
  const moved = [...new Set(fresh.filter((s) => s.run && (s.kind === 'story' || s.rests || s.ends)).map((s) => s.run))];
  if (moved.length) hooks.sessionsTold?.(moved);
  // A chat renamed is named anew on its tab.
  if (fresh.some((s) => s.did === 'titled')) hooks.drawStrip?.();
  // A later show takes the place of what waits, and its tab of its own, if it was owed one, stays owed; so does its tab brought into sight.
  for (const s of fresh) if (s.kind === 'show' && s.hash) {
    const was = waiting.get(sessionOf(s));
    waiting.set(sessionOf(s), { ...s, opens: s.opens || was?.opens, focus: s.focus || was?.focus });
  }
  if (document.querySelector('dialog[open]')) return;
  // A part on `tabs` is told each show, and keeps what waits itself (it decides where a show lands, task e_dswpuaft).
  for (const [session, s] of waiting) if (hooks.tellSlot?.('tabs', { name: 'land', step: s })) waiting.delete(session);
  if (!hooks.land) return;
  // One the reader is busy where it would land stays, and is tried again at the next look.
  for (const [session, s] of waiting) if (hooks.land(s) !== 'later') waiting.delete(session);
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

/**
 * What was missed since the person last looked (ui/catch-up.js says when, by name), handed to the parts on `traces`:
 * entry by entry from the rows as they were (each row's island is on it), and one beat for the whole span.
 */
hooks.tellMissed = (then, kinds, entries, { from, to, gone = [] }) => {
  if (!hooks.slotFilled?.('traces')) return;
  hooks.tellSlot('traces', { name: 'missed', from, to, entries: missedRows(then, kinds, entries) });
  hooks.tellSlot('traces', { name: 'beat', ...beatRows(then, kinds, entries, { after: from, gone }) });
};

/** A redraw under way: another is not started on top of it. */
export let redrawing = false;
export async function checkTail() {
  if (still || document.hidden || redrawing) return;
  let now;
  let touched;
  let more = false;
  try {
    // From the furthest back of the page and its store, on everything it holds and the islands its views touch.
    // A store being played from where its reader last looked is left alone until it ends (the replay mark: ./replay.js).
    const following = store.views.size > 0 && !store.playing;
    const at = [state.pos, ...(following ? [store.pos] : [])].filter((pos) => pos !== undefined);
    const from = at.length ? Math.min(...at) : undefined;
    const ids = [...new Set([...shownIds(), ...(following ? store.ids() : [])])];
    const islands = following ? store.islands() : [];
    const beat = await api('tail', { ...(from === undefined ? { page: thisPage() } : { after: from, seq: state.seq, ids, ...(islands.length && { islands }), page: thisPage() }) });
    // Only an answer that read the facts moves the store: one that says only where the log stands would skip them.
    if (beat.entries && following) {
      try {
        // What the facts changed of what the store held, worked out before they are folded in, once: told to the trace
        // overlay as rows, which catch_up.changes traces until seen.
        const fresh = store.fresh(beat.entries);
        const from = store.pos;
        const { rows } = rowsOf(store, kinds, fresh, beat.gone);
        store.apply(beat);
        if (rows.length) hooks.tellSlot?.('traces', { name: 'beat', from, to: beat.pos, rows });
      } catch (err) {
        console.error(err);
      }
    }
    queueMoved(beat.queue).catch(() => {});
    touched = state.pos === undefined ? undefined : touchedBy(beat, state.pos);
    now = `${beat.pos}.${beat.seq}.${beat.queue}`;
    state.pos = beat.pos;
    looked(beat.pos);
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
