import { api, h, hooks, main, route, state } from './base.js';

// ---- live updates --------------------------------------------------------

// The server's pulse moves whenever the map or what is held for the owner does, and says
// which items the changes since the last look touched. The page is drawn again, in place,
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
/** Where each agent that tells a story tells it: following it goes there, not from item to item. */
export const storyOf = new Map();

export function follow(steps = []) {
  // The first answer only says where things stand; an old step is not followed.
  const fresh = seenStep === undefined ? [] : steps.filter((s) => s.at > seenStep);
  seenStep = steps.at(-1)?.at ?? seenStep ?? 0;
  for (const s of steps) {
    heardFrom.add(s.actor);
    if (s.kind === 'story') storyOf.set(s.actor, s.hash);
  }
  following.working = new Set(steps.filter((s) => Date.now() - s.at < 600_000).map((s) => s.actor)).size;
  followBox.checked = following.on;
  if (!following.on) return;
  const wanted = fresh.filter((s) => chosen.kinds.has(s.kind) && !chosen.muted.has(s.actor));
  // The line says the last thing done; the page goes to the last that has a place. A step may have none: then the page stays.
  const to = wanted.at(-1);
  if (!to) return;
  const place = wanted.findLast((s) => s.hash || storyOf.has(s.actor));
  const there = place && `#/${storyOf.get(place.actor) ?? place.hash}`;
  const busy = state.dirty || document.querySelector('dialog[open]') || reading();
  followed.replaceChildren(
    ...[
      // One line: who, and the first few words of why. The whole reason is on the page it brought you to.
      h('strong', {}, to.actor.split('/').at(-1)),
      h('span', { class: 'grow', title: to.did ?? '' }, to.did ? to.did.split(/(?<=[.:;])\s/)[0] : busy ? 'is working somewhere else' : 'brought you here'),
      busy && there && location.hash !== there && h('button', { onclick: () => ((location.hash = there), (followed.hidden = true)) }, 'Go there'),
      h('button', { title: 'Stop following agents', onclick: () => ((following.on = followBox.checked = false), (followed.hidden = true)) }, 'Stop following'),
    ].filter(Boolean),
  );
  followed.hidden = false;
  clearTimeout(followedTimer);
  followedTimer = setTimeout(() => (followed.hidden = true), 12000);
  if (!busy && there && location.hash !== there) location.hash = there;
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

/** Whether what changed (the pulse's `touched`, and whether the held changes or a story moved) bears on the page in view. */
export function bears(touched, queueMoved) {
  if (!touched || touched.ids === null) return true;
  // A list or a screen may hold an item just made; Home holds what waits for the owner.
  if (/^#\/(map|s\/)/.test(location.hash) && touched.made) return true;
  if (queueMoved && (!/^#\/e\//.test(location.hash) || main.querySelector('.story'))) return true;
  const ids = shownIds();
  return touched.ids.some((id) => ids.has(id));
}

/** A redraw under way: another is not started on top of it. */
export let redrawing = false;
export async function checkPulse() {
  if (document.hidden || redrawing) return;
  let now;
  let touched;
  try {
    const beat = await api('pulse', state.seq === undefined ? {} : { since: state.seq });
    now = beat.stamp;
    touched = beat.touched;
    state.seq = touched?.seq ?? state.seq;
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
  const was = state.pulse;
  const moved = was !== undefined && now !== was;
  state.pulse = now;
  if (!moved) return;
  if (state.selfDrawn) return void (state.selfDrawn = false);
  // Only the map's events moved, and none of them is on the sheet: it stays as it is, and the canvas asks again if
  // they are on it (drawn again only where its answer changed).
  if (!bears(touched, now.split('.').slice(1).join() !== was.split('.').slice(1).join())) {
    const drawn = canvasView();
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
setInterval(checkPulse, 2000);
document.addEventListener('visibilitychange', checkPulse);
