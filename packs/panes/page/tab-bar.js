// Tabs at the top of the page and the panes of the one in sight (decision e_mzer5m4t), drawn by the panes pack's part
// (packs/panes/parts/index.js): the strip in the top bar, the panes in #canvas, one part mounted twice so one model.
// Every chat at work has a tab of its own, opened and closed as it begins and ends; tabs merge, pop out and dock back.
// This starts the part, gives the query bar its back, forth and split for the pane in focus, and keeps beside the strip
// the count of sessions waiting on the owner, which goes to the oldest (e_82rggead). A look's page,
// and a frozen link's, draw their one view in a pane of their own, with no tabs.

import { api, drawSlot, firstDrawn, h, hooks } from './base.js';
import { still } from './look.js';
import { heard, hearOpen, nameOf } from './pane-route.js';
import { lonePane } from './panes.js';
import { atOf } from './pane-address.js';
import { poppedTab } from './tabs.js';

const strip = document.getElementById('tabs');

/**
 * Draw the tabs and the panes with the panes pack's part. The query bar's back, forth and split go to it: a step of
 * the browser's, and `split` told; in a popped window, Dock back too. True when a part filled them.
 */
async function startPart() {
  const canvas = document.getElementById('canvas');
  if (!strip || !canvas) return false;
  // The strip lets presses through but for its tabs (ui/shell.css): the part's strip takes them.
  const top = h('div', { class: 'tabs-part', style: 'pointer-events: auto' });
  const filled = await drawSlot(top, { slot: 'tabs' }).catch((err) => (console.warn('The panes part did not draw:', err), false));
  if (!filled) return false;
  strip.replaceChildren(top);
  const panes = h('div', { class: 'panes-part' });
  canvas.replaceChildren(panes);
  await drawSlot(panes, { slot: 'tabs', piece: { slot: 'panes' } });
  document.body.dataset.panesBy = 'part';
  const button = (label, title, mark, onclick) => h('button', { type: 'button', class: 'q-save', title, 'aria-label': label, onclick }, mark);
  hooks.paneButtons = () => [
    button('Back', 'Back to what this pane drew before', '‹', () => history.back()),
    button('Forward', 'Forward again', '›', () => history.forward()),
    button('Split', 'Split: a new pane beside this one', '◫', () => hooks.tellSlot?.('tabs', { name: 'split' })),
    // In a popped window, its tab goes back into the main one as it closes.
    poppedTab && button('Dock back', 'Dock this window back into the main one, as a tab', '⇲', () => (hooks.tellSlot?.('tabs', { name: 'dock' }), setTimeout(() => window.close(), 300))),
  ].filter(Boolean);
  return true;
}

// ---- The sessions waiting on the owner, counted beside the strip, so every tab sees them (docs/sessions.md).

/** The states that wait on the owner, each its mark and what it is called. */
const YOURS = { waiting: { mark: '?', said: 'waits on you' }, your_move: { mark: '↩', said: 'your move' } };
/** The open sessions waiting on the owner, the one waiting longest first. */
const onYou = (open = []) =>
  open
    .filter((s) => YOURS[s.session?.state])
    .sort((a, b) => (Date.parse(a.session.since) || 0) - (Date.parse(b.session.since) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
/** The count's tooltip: one line for each waiting on the owner, by its line, oldest first. */
const countTip = (yours, nameOf) => yours.map((s) => `${YOURS[s.session.state].mark} ${nameOf(s)}: ${s.session.line ?? YOURS[s.session.state].said}`).join('\n');

/** The sessions open now, as the `sessions` view last answered. */
let open = [];
const countEl = h('button', { type: 'button', class: 'tab-count', hidden: true });
strip?.after(countEl);
function drawCount() {
  const yours = onYou(open);
  countEl.hidden = !yours.length || Boolean(poppedTab);
  if (countEl.hidden) return;
  const tip = countTip(yours, (s) => (heard.has(s.id) ? nameOf(s.id) : s.title ?? s.id));
  countEl.title = tip;
  countEl.setAttribute('aria-label', `${yours.length} waiting on you: ${tip}`);
  countEl.replaceChildren(h('span', { class: 'tab-state', 'aria-hidden': 'true' }, '↩'), String(yours.length));
  countEl.onclick = () => {
    // To the oldest one's page: the part keeps which tab is whose.
    location.hash = `#/e/${yours[0].id}`;
  };
}
/** Ask which sessions are open, and count those waiting on the owner. */
const readOpen = () => api('view', { name: 'sessions' }).then((got) => ((open = got.open ?? []), hearOpen(open), drawCount()), () => {});
/** A session was heard from (packs/surface/page/live.js): its state may have moved, so the open ones are read again, once for a burst. */
let rereading;
hooks.sessionsMoved = () => {
  if (poppedTab || rereading) return;
  rereading = setTimeout(() => ((rereading = undefined), readOpen(), hooks.tellSlot?.('tabs', { name: 'sessions' })), 1000);
};
/** A session renamed: the tabs read the sessions again, so a tab is called by its chat's new title. */
hooks.drawStrip = () => hooks.tellSlot?.('tabs', { name: 'sessions' });

let started = false;
/** Draw the tabs and the panes, once the map's schema is read (packs/surface/page/app.js): what they draw is read through it. */
export function startTabs() {
  if (started) return;
  started = true;
  if (still) return lonePane(atOf(location.hash) ?? 'v');
  void startPart().then((drawn) => drawn || canvasFailed());
  if (poppedTab) return;
  // What is open is read once the first view has drawn, by the count and by the part, never before it.
  firstDrawn.then(() => (readOpen(), hooks.tellSlot?.('tabs', { name: 'sessions' })));
  // Coming back to the page, what ended or began while it was out of sight is counted again.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && readOpen());
}

/** No part drew the tabs: the page says so where the canvas would be, rather than standing empty. */
function canvasFailed() {
  document.getElementById('canvas')?.replaceChildren(h('div', { class: 'error' }, 'The panes did not draw: reload the page.'));
}
