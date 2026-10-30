// Where an agent's step lands on the owner's page (ui/live.js): ui/pane-route.js works it out from whom each tab
// follows, whose each pane is and where the reader is busy (ui/pane-busy.js), and this does it: a pane of the tab in
// sight drawn again or split, a tab brought into sight, a tab in the background given the step and marked (decision
// e_xjrpyysn), a tab of its own opened, or the window a tab was popped out into moved. A pane a session's step lands in
// is held for it (`held`), kept with the tab, so its next step goes there again, however long it works.

import { hooks } from './base.js';
import { busy, windowOf } from './pane-busy.js';
import { nameOf, route, sessionOf } from './pane-route.js';
import { activeId, flash, goPane, markPanes, only, openPane, paneAt, place } from './panes.js';
import { arrived, drawStrip, openTab, toFront } from './tab-bar.js';
import { drawable, focusOf, keep, landed, named, outTabs, poppedTab, tabOf, tabs } from './tabs.js';

/** The page starts its tabs through here (ui/app.js), so that where a step lands is loaded with them. */
export { startTabs } from './tab-bar.js';

/** An item's page, as a show names one: it opens over the pane that draws it when that pane is in focus. */
const itemOf = (at) => /^e\/(e_[a-z0-9]{8})(?:\?|$)/.exec(at)?.[1];

/** Land an agent's show where it goes: a pane, a tab in the background, a window of its own, or nowhere where no tab takes it. */
hooks.land = (step) => {
  if (poppedTab) return;
  const at = step.hash;
  const session = sessionOf(step);
  const now = Date.now();
  const paneOf = (t, id, inSight) => ({
    id,
    slot: t.panes[id]?.slot,
    held: t.panes[id]?.held,
    focus: id === (inSight ? activeId() : focusOf(t)),
    landed: landed.get(`${t.id}:${id}`),
    busy: inSight && busy(id),
    draws: named(t.panes[id]?.at) === named(paneAt(at)),
  });
  const docked = tabs.list.map((t) => ({ id: t.id, follows: t.follows ?? 'all', front: t.id === tabs.front, panes: t.groups.map((g) => paneOf(t, g, t.id === tabs.front)) }));
  const out = outTabs()
    .filter((t) => !tabOf(t.id) && windowOf(t.id))
    .map((t) => ({ id: t.id, follows: t.follows ?? 'all', popped: true, panes: [{ ...paneOf(t, focusOf(t), false), busy: busy(t.id) }] }));
  const to = route(step, [...docked, ...out], { now, recent: 600_000, drawable: drawable(at) });
  // The pane is held for the session from now on, unless it is the reader's in focus (lit only because it drew this) or
  // named; its strip's mark says who sent it, and the mark's tooltip why (ui/panes.js).
  const lit = (t, pane) => {
    landed.set(`${t.id}:${pane}`, { session, at: now });
    const p = t.panes[pane];
    if (p && t.follows !== session && !p.slot && pane !== (t.id === tabs.front ? activeId() : focusOf(t))) p.held = session;
    if (p) p.said = step.did;
    keep();
  };
  try {
    if (to.nowhere) return;
    if (to.open) {
      // A page that is no canvas opens over a tab's Home, as one of its own open over its pane does.
      const id = openTab(drawable(at) ? `#/${at}` : '#/', { follows: to.open.follows, named: nameOf(to.open.follows), ...(to.open.slot && { slot: to.open.slot }) }, to.front);
      const t = tabOf(id);
      if (itemOf(at) || !drawable(at)) ((t.sheet = itemOf(at) ? `e/${itemOf(at)}` : at.split('?')[0]), keep());
      lit(t, focusOf(t));
      if (to.front) location.replace(`#/${at}`);
      return void (to.front && flash(focusOf(t)));
    }
    const t = tabOf(to.tab);
    if (!t) {
      const win = windowOf(to.tab);
      if (!win) return;
      win.location.hash = `#/${at}`;
      landed.set(`${to.tab}:${to.pane}`, { session, at: now });
      return;
    }
    const split = () => openPane(at, to.split.side, t.groups.at(-1), { ...(to.split.slot && { slot: to.split.slot }), ...(!to.split.slot && t.follows !== session && { held: session }) }, t);
    // Not a canvas (a screen, the workspace): the page opens over the tab's pane in focus.
    if (!drawable(at)) {
      if (t.id === tabs.front) location.hash = `#/${at}`;
      else ((t.sheet = at.split('?')[0]), keep(), arrived(t.id));
      return;
    }
    if (!to.front && t.id !== tabs.front) {
      // Out of sight: where its panes stand is kept, and drawn when the tab is brought into sight.
      const pane = to.split ? split() : to.pane;
      if (!pane) return;
      if (to.side === 'alone') only(pane, t);
      else if (to.side) place(pane, to.side, t.groups.find((g) => g !== pane) ?? pane, t);
      t.panes[pane] = { ...t.panes[pane], at: paneAt(at) };
      // An item's page asked for opens over its pane when the tab is brought into sight, if that pane is its one in focus.
      if (itemOf(at) && pane === focusOf(t)) t.sheet = `e/${itemOf(at)}`;
      keep();
      lit(t, pane);
      arrived(t.id);
      return;
    }
    toFront(t.id);
    const id = to.split ? split() : to.pane;
    if (!id) return;
    if (to.side === 'alone') only(id);
    else if (to.side && !to.split) place(id, to.side, t.groups.find((g) => g !== id) ?? id);
    goPane(id, paneAt(at));
    lit(t, id);
    // An item's page asked for opens over its pane when that pane is the one in focus.
    if (itemOf(at) && id === activeId()) location.hash = `#/e/${itemOf(at)}?${queryOf(t, id)}`;
    flash(id);
  } finally {
    markPanes();
    drawStrip();
  }
};
/** The lens query a pane of tab `t` stands at, for an item's page over it. */
const queryOf = (t, id) => (t.panes[id]?.at ?? '').split('?')[1] ?? '';
