// The chats open now (the `sessions` view, docs/sessions.md), read once for the page and handed to what draws them: the
// island side bar's Sessions part (./island-sessions.js), the count of those waiting on the owner in the band
// (e_82rggead), and the names a show is lit under (./pane-route.js). Read once the first view has drawn, again a second after a session is heard from (one read for a burst), and on coming back to the page.

import { api, firstDrawn, h, hooks } from './base.js';

/** The states that wait on the owner, each its mark and what it is called. */
export const YOURS = { waiting: { mark: '✉', said: 'waits on you' }, your_move: { mark: '✉', said: 'your move' } };
/** The open sessions waiting on the owner, the one waiting longest first. */
export const onYou = (open = []) =>
  open
    .filter((s) => YOURS[s.session?.state])
    .sort((a, b) => (Date.parse(a.session.since) || 0) - (Date.parse(b.session.since) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** The sessions open now, as the view last answered, and whether it has answered yet. */
let open = [];
let read = false;
const listeners = new Set();
/** Hear the open sessions each time they are read (at once, if they have been). */
export function onOpen(fn) {
  listeners.add(fn);
  if (read) fn(open);
}
/** The open sessions as last read. */
export const openNow = () => open;

const readOpen = () =>
  api('view', { name: 'sessions' }).then(
    (got) => {
      open = got.open ?? [];
      read = true;
      for (const fn of listeners) fn(open);
    },
    () => {},
  );
let rereading;
hooks.sessionsMoved = () => {
  if (rereading) return;
  rereading = setTimeout(() => ((rereading = undefined), readOpen()), 1000);
};
firstDrawn.then(readOpen);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && readOpen());

// ---- The count of those waiting on the owner, in the band beside the islands button: an inbox (the
// page's one mark for what waits on you, inbox.svg), its count a badge on it, as a mail app's (Alex, 17 Nov 2026).

const badge = h('span', { class: 'q-waiting-badge', 'aria-hidden': 'true' });
const count = h('button', { type: 'button', class: 'q-waiting', hidden: true }, h('span', { class: 'on-you', 'aria-hidden': 'true' }), badge);
/** A session's line for a tooltip: its mark, its name, what it waits on. */
const lineOf = (s) => `${YOURS[s.session.state].mark} ${s.title ?? s.id}: ${s.session.line || YOURS[s.session.state].said}`;
onOpen((list) => {
  const yours = onYou(list);
  count.hidden = !yours.length;
  if (count.hidden) return;
  const tip = yours.map(lineOf).join('\n');
  count.title = tip;
  count.setAttribute('aria-label', `${yours.length} waiting on you: ${tip}`);
  badge.textContent = String(yours.length);
  // To the oldest one's page.
  count.onclick = () => (location.hash = `#/e/${yours[0].id}`);
});
/** The count, for the band to hold (packs/surface/page/canvas.js). */
hooks.waitingButton = () => count;
