// Where an agent's step lands on the owner's page (ui/live.js): ui/pane-route.js works it out from whom each tab
// follows and where the reader is busy (ui/pane-busy.js), and this does it: a pane of the tab in sight drawn again or
// split, a tab brought into sight, a tab in the background given the step and marked (decision e_xjrpyysn), a tab of its
// own opened, or the window a tab was popped out into moved.

import { hooks } from './base.js';
import { canvasHref } from './canvas.js';
import { busy, windowOf } from './pane-busy.js';
import { heard, nameOf, route, sessionOf } from './pane-route.js';
import { alone, flash, goPane, openPane, place } from './panes.js';
import { arrived, drawStrip, openTab, toFront } from './tab-bar.js';
import { drawable, keep, landed, named, outTabs, poppedTab, tabOf, tabs } from './tabs.js';

/** The page starts its tabs through here (ui/app.js), so that where a step lands is loaded with them. */
export { startTabs } from './tab-bar.js';

/** A step drawn in a tab out of sight: the line offers to bring it into sight. */
const aside = (id) => ({ tab: id, open: () => toFront(id) });

/**
 * Where an agent's step lands: 'main' for the canvas of the tab in sight, which the address then moves; the frame of a
 * docked pane that draws it; 'popped' for a tab in a window of its own; { tab, open } for a tab in the background; or
 * null where no tab takes it, and it is only offered.
 */
hooks.land = (step) => {
  if (poppedTab) return null;
  const at = step.hash;
  const session = sessionOf(step);
  const now = Date.now();
  const paneOf = (t, id, inSight) => ({
    id,
    slot: id === 'main' ? t.slot : t.panes[id]?.slot,
    landed: landed.get(`${t.id}:${id}`),
    busy: inSight && busy(id),
    draws: named(id === 'main' ? (inSight ? canvasHref() : t.at) : t.panes[id]?.at) === named(at),
  });
  const docked = tabs.list.map((t) => ({ id: t.id, follows: t.follows ?? 'all', front: t.id === tabs.front, panes: t.groups.map((g) => paneOf(t, g, t.id === tabs.front)) }));
  const out = outTabs()
    .filter((t) => !tabOf(t.id) && windowOf(t.id))
    .map((t) => ({ id: t.id, follows: t.follows ?? 'all', popped: true, panes: [{ ...paneOf(t, 'main', false), busy: busy(t.id) }] }));
  const others = [...heard].filter(([key, o]) => key !== session && now - o.at < 600_000).length;
  const to = route(step, [...docked, ...out], { now, recent: 600_000, settle: 30_000, others, drawable: drawable(at) });
  const lit = (tab, pane) => (landed.set(`${tab}:${pane}`, { session, at: now }), keep());
  try {
    if (to.offer) return null;
    if (to.open) {
      const id = openTab(`#/${at}`, { follows: to.open.follows, named: nameOf(to.open.follows), ...(to.open.slot && { slot: to.open.slot }) }, to.front);
      lit(id, 'main');
      return to.front ? 'main' : aside(id);
    }
    const t = tabOf(to.tab);
    if (!t) {
      const win = windowOf(to.tab);
      if (!win) return null;
      win.location.hash = `#/${at}`;
      lit(to.tab, 'main');
      return 'popped';
    }
    const split = (where) => openPane(at, to.split.side, 'main', to.split.slot ? { slot: to.split.slot } : {}, where);
    if (!to.front && t.id !== tabs.front) {
      // Out of sight: where its panes stand is kept, and drawn when the tab is brought into sight.
      const pane = to.split ? split(t) : to.pane;
      if (to.side === 'alone') Object.assign(t, { dir: 'row', groups: ['main'], sizes: [1], panes: {} });
      if (pane === 'main') t.at = `#/${at}`;
      else if (pane) (t.panes[pane] = { ...t.panes[pane], at }), to.side && place(pane, to.side, 'main', t);
      keep();
      lit(t.id, pane ?? 'main');
      arrived(t.id);
      return aside(t.id);
    }
    if (to.pane === 'main') t.at = `#/${at}`;
    toFront(t.id);
    if (to.pane === 'main') {
      if (to.side === 'alone') alone();
      lit(t.id, 'main');
      return 'main';
    }
    const id = to.split ? split(t) : to.pane;
    if (!id) return null;
    if (to.side) place(id, to.side, 'main');
    goPane(id, at);
    lit(t.id, id);
    return flash(id);
  } finally {
    drawStrip();
  }
};
