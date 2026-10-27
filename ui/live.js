import { api, h, hooks, main, route, state } from './base.js';
import { follow as keepCurrent, followed as kept, Replica } from './replica.js';
import { lookMode } from './look.js';
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
main.addEventListener('input', (e) => {
  if (e.target.tagName !== 'SELECT') state.dirty = true;
});

// Following: an agent can point this page at what it is working on (the `show`
// tool, and every change it makes). With "Follow agents" on, the page goes
// there; a line at the bottom says who sent it and why. Anything half done on
// the page, or a reader in the middle of reading it, is kept, and the line offers
// the jump instead. Until the reader chooses, it is on only while one agent at most is at work.
export const following = {
  /** How many agents took a step lately: more than one, and nothing is followed unless the reader asks. */
  working: 0,
  get on() {
    // A window popped out of the main page (ui/panes.js) draws one pane; the main page follows for it.
    if (window.name.startsWith('pelago-pane:')) return false;
    try {
      const kept = localStorage.getItem('pelago-follow');
      if (kept) return kept !== 'off';
    } catch {
      // Without storage, as if nothing was chosen.
    }
    return this.working <= 1;
  },
  set on(value) {
    try {
      localStorage.setItem('pelago-follow', value ? 'on' : 'off');
    } catch {
      // Without storage the choice lasts until the page is reloaded.
    }
  },
  // Which kinds of step are followed (as it was before there was a choice: what is shown and what is changed), and whose are not.
  list(key, otherwise) {
    try {
      const kept = JSON.parse(localStorage.getItem(`pelago-follow-${key}`));
      return Array.isArray(kept) ? kept : otherwise;
    } catch {
      return otherwise;
    }
  },
  keep(key, list) {
    try {
      localStorage.setItem(`pelago-follow-${key}`, JSON.stringify(list));
    } catch {
      // Without storage the choice lasts until the page is reloaded.
    }
  },
};
/** The kinds of step an agent takes, as the server names them and as a person reads them. */
export const STEP_KINDS = [
  ['show', 'What they show you'],
  ['change', 'What they change'],
  ['story', 'The story they tell'],
  ['read', 'What they read'],
  ['view', 'Views they ask for'],
  ['search', 'What they search for'],
  ['other', 'Sessions and the rest'],
];
export const followBox = document.querySelector('#follow input');
followBox.checked = following.on;
followBox.addEventListener('change', () => (following.on = followBox.checked));
export const chosen = { kinds: new Set(following.list('kinds', ['show', 'change', 'story'])), muted: new Set(following.list('muted', [])) };
/** The agents heard from while the page is open, with those left out before: each can be left out. */
export const heardFrom = new Set(chosen.muted);
export function followMenu() {
  const tick = (label, title, on, set) => h('label', { title }, h('input', { type: 'checkbox', checked: on, onchange: (ev) => set(ev.target.checked) }), h('span', {}, label));
  const flip = (key, value) => (yes) => (chosen[key][yes === (key === 'kinds') ? 'add' : 'delete'](value), following.keep(key, [...chosen[key]]));
  document.querySelector('#follow-what > .menu-items').replaceChildren(
    ...STEP_KINDS.map(([kind, label]) => tick(label, label, chosen.kinds.has(kind), flip('kinds', kind))),
    ...(heardFrom.size ? [h('hr')] : []),
    ...[...heardFrom].sort().map((actor) => tick(actor.split('/').at(-1), `Follow ${actor}`, !chosen.muted.has(actor), flip('muted', actor))),
  );
}
followMenu();
// An agent first heard from while the menu was open is in it the next time it opens.
document.getElementById('follow-what').addEventListener('toggle', (ev) => ev.target.open && followMenu());
export const followed = h('div', { id: 'followed', hidden: true });
document.body.append(followed);
export let seenStep;
/** When the reader last scrolled, pointed or typed: a page being read is not moved under them. */
let readAt = 0;
for (const name of ['scroll', 'wheel', 'pointermove', 'pointerdown', 'keydown']) addEventListener(name, () => (readAt = Date.now()), { passive: true, capture: true });
const reading = () => Date.now() - readAt < 20_000 || Boolean(getSelection()?.toString());
export let followedTimer;
/** This page, among the owner's open pages: the server counts those that follow, so an agent's show says whether it landed. */
const pageId = Math.random().toString(36).slice(2, 14);
// A page the server draws for an agent's look is no page of the owner's: it is not counted, and follows nobody.
const thisPage = () => (lookMode ? undefined : { page: pageId, on: following.on && chosen.kinds.has('show'), muted: [...chosen.muted] });
/** Where each agent that tells a story tells it: following it goes there, not from item to item. */
export const storyOf = new Map();

export function follow(steps = []) {
  // A look's page, and a popped-out pane, leave what agents show to the main page.
  if (lookMode || window.name.startsWith('pelago-pane:')) return;
  // The first answer only says where things stand; an old step is not followed.
  const fresh = seenStep === undefined ? [] : steps.filter((s) => s.at > seenStep);
  seenStep = steps.at(-1)?.at ?? seenStep ?? 0;
  for (const s of steps) {
    heardFrom.add(s.actor);
    if (s.kind === 'story') storyOf.set(s.actor, s.hash);
  }
  following.working = new Set(steps.filter((s) => Date.now() - s.at < 600_000).map((s) => s.actor)).size;
  followBox.checked = following.on;
  // A page not following still offers what an agent showed: the line, and the way there.
  const wanted = fresh.filter((s) => (following.on ? chosen.kinds.has(s.kind) : s.kind === 'show') && !chosen.muted.has(s.actor));
  // The line says the last thing done; the page goes to the last that has a place. A step may have none: then the page stays.
  const to = wanted.at(-1);
  if (!to) return;
  const place = wanted.findLast((s) => s.hash || storyOf.has(s.actor));
  const there = place && `#/${storyOf.get(place.actor) ?? place.hash}`;
  const busy = !following.on || state.dirty || document.querySelector('dialog[open]') || reading();
  followed.replaceChildren(
    ...[
      // One line: who, and the first few words of why. The whole reason is on the page it brought you to.
      h('strong', {}, to.actor.split('/').at(-1)),
      h('span', { class: 'grow', title: to.did ?? '' }, to.did ? to.did.split(/(?<=[.:;])\s/)[0] : busy ? 'is working somewhere else' : 'brought you here'),
      busy && there && location.hash !== there && h('button', { onclick: () => ((location.hash = there), (followed.hidden = true)) }, 'Go there'),
      following.on && h('button', { title: 'Stop following agents', onclick: () => ((following.on = followBox.checked = false), (followed.hidden = true)) }, 'Stop following'),
    ].filter(Boolean),
  );
  followed.hidden = false;
  clearTimeout(followedTimer);
  // A show offered to a page not following stays longer: it is the only way the reader hears of it.
  followedTimer = setTimeout(() => (followed.hidden = true), following.on ? 12000 : 60000);
  // A canvas docked beside the main one draws it, when the show asked for a pane or one draws it already (ui/panes.js); else the main canvas goes there.
  const frame = !busy && place?.kind === 'show' && place.hash ? hooks.showIn?.(place.hash, place.pane) : null;
  if (!busy && there && !frame && location.hash !== there) location.hash = there;
}

/** The items the sheet shows: what it is the page of, what it names or links to, and what its views hold. */
export function shownIds() {
  const ids = new Set(location.hash.match(/e_[a-z0-9]{8}/g) ?? []);
  for (const a of main.querySelectorAll('a[href*="e_"]')) for (const id of a.getAttribute('href').match(/e_[a-z0-9]{8}/g) ?? []) ids.add(id);
  for (const n of main.querySelectorAll('[data-root], [data-item]')) ids.add(n.dataset.root ?? n.dataset.item);
  for (const host of main.querySelectorAll('.lens-wrap')) for (const item of host.answer?.items ?? []) ids.add(item.id);
  return ids;
}
/** The canvas behind the sheet (ui/canvas.js): the view it draws. */
const canvasView = () => document.querySelector('#canvas > .lens-wrap');

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
    const drawn = canvasView();
    // A canvas whose answer is held in a store is kept current by the facts themselves (ui/replica.js).
    if (drawn?.store) return;
    if (!touched || touched.ids === null || touched.made || touched.ids.some((id) => drawn?.answer?.items.some((i) => i.id === id))) drawn?.refresh?.();
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
