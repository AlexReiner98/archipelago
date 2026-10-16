import { api, h, main, route, state } from './base.js';
import { kept, label, refreshReviewCount } from './words.js';

// ---- live updates --------------------------------------------------------

// The server's pulse moves whenever the map or the review queue does. The page
// is drawn again when it moves, unless that would throw away something half
// done (typed text, ticked boxes, an open question, a graph being explored);
// then a notice offers the refresh instead.
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
// the page is kept, and the line offers the jump instead.
export const following = {
  get on() {
    try {
      return localStorage.getItem('pelago-follow') !== 'off';
    } catch {
      return true;
    }
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
  ['view', 'Views and pictures they ask for'],
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
  if (!following.on) return;
  const wanted = fresh.filter((s) => chosen.kinds.has(s.kind) && !chosen.muted.has(s.actor));
  // The line says the last thing done; the page goes to the last that has a place. A step may have none: then the page stays.
  const to = wanted.at(-1);
  if (!to) return;
  const place = wanted.findLast((s) => s.hash || storyOf.has(s.actor));
  const there = place && `#/${storyOf.get(place.actor) ?? place.hash}`;
  const busy = state.dirty || document.querySelector('dialog[open]');
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

/** A page that has just drawn itself again after its own change: the change the pulse then sees is already on it. */
/** A redraw under way: another is not started on top of it. */
export let redrawing = false;
export async function checkPulse() {
  if (document.hidden || redrawing) return;
  let now;
  try {
    const beat = await api('pulse');
    now = beat.stamp;
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
  } catch {
    return;
  }
  const moved = state.pulse !== undefined && now !== state.pulse;
  state.pulse = now;
  if (!moved) return;
  if (state.selfDrawn) return void (state.selfDrawn = false);
  if (state.dirty || document.querySelector('dialog[open]') || /^#\/new/.test(location.hash)) {
    refreshReviewCount();
    stale.hidden = false;
    return;
  }
  // Hold the page's height while it is redrawn, so the scroll position stays.
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
