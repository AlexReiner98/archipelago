// Tabs at the top of the page and the panes of the one in sight (decision e_mzer5m4t), drawn by the panes pack's part
// (packs/panes/parts/index.js): the strip in the top bar, the panes in #canvas, one part mounted twice so one model.
// Every chat at work has a tab of its own, opened and closed as it begins and ends; a tab is one canvas.
// This starts the part and gives the bar its back and forth; the count of sessions waiting on the owner is in the
// band (./sessions-open.js). A look's page,
// and a frozen link's, draw their one view in a pane of their own, with no tabs.

import { drawSlot, h, hooks } from './base.js';
import { still } from './look.js';
import { hearOpen } from './pane-route.js';
import { onOpen } from './sessions-open.js';
import { lonePane } from './panes.js';
import { atOf } from './pane-address.js';

const strip = document.getElementById('tabs');

/**
 * Draw the tabs and the canvas with the panes pack's part. The bar's back and forth go to it, as a step of the
 * browser's. True when a part filled them.
 */
async function startPart() {
  const canvas = document.getElementById('canvas');
  if (!strip || !canvas) return false;
  // The strip lets presses through but for its tabs (packs/surface/page/shell.css): the part's strip takes them.
  const top = h('div', { class: 'tabs-part', style: 'pointer-events: auto' });
  const filled = await drawSlot(top, { slot: 'tabs' }).catch((err) => (console.warn('The panes part did not draw:', err), false));
  if (!filled) return false;
  strip.replaceChildren(top);
  const panes = h('div', { class: 'panes-part' });
  canvas.replaceChildren(panes);
  await drawSlot(panes, { slot: 'tabs', piece: { slot: 'panes' } });
  document.body.dataset.panesBy = 'part';
  // The pane in focus's frame moved (the runtime lays the panes out, packs/walls/page/part-pane.js): what fits itself to it
  // (find's line, the canvas) is told, as the page's own panes told it.
  let frame = '';
  let soon;
  new MutationObserver(() => {
    const now = ['left', 'right', 'top', 'bottom'].map((s) => document.body.style.getPropertyValue(`--active-${s}`)).join(' ');
    if (now === frame) return;
    frame = now;
    // How many panes stand: the page's own rules lay one alone out apart (packs/surface/page/shell.css, body[data-panes]).
    document.body.dataset.panes = String(document.querySelectorAll('#canvas .pm-pane').length);
    clearTimeout(soon);
    soon = setTimeout(() => dispatchEvent(new Event('resize')), 30);
  }).observe(document.body, { attributes: true, attributeFilter: ['style'] });
  const button = (label, title, mark, onclick) => h('button', { type: 'button', class: 'q-save q-travel', title, 'aria-label': label, onclick }, mark);
  hooks.paneButtons = () => [
    button('Back', 'Back to what this pane drew before', '‹', () => history.back()),
    button('Forward', 'Forward again', '›', () => history.forward()),
  ];
  return true;
}

// ---- The open sessions (./sessions-open.js reads them, and counts those waiting on the owner in the band): the tabs
// hear them, so a chat's tab is called by its title, and the part is told to read them again.
onOpen((open) => (hearOpen(open), hooks.tellSlot?.('tabs', { name: 'sessions' })));
/** A session renamed: the tabs read the sessions again, so a tab is called by its chat's new title. */
hooks.drawStrip = () => hooks.tellSlot?.('tabs', { name: 'sessions' });

let started = false;
/** Draw the tabs and the panes, once the map's schema is read (packs/shell/page/app.js): what they draw is read through it. */
export function startTabs() {
  if (started) return;
  started = true;
  if (still) return lonePane(atOf(location.hash) ?? 'v');
  void startPart().then((drawn) => drawn || canvasFailed());
}

/** No part drew the tabs: the page says so where the canvas would be, rather than standing empty. */
function canvasFailed() {
  document.getElementById('canvas')?.replaceChildren(h('div', { class: 'error' }, 'The panes did not draw: reload the page.'));
}
