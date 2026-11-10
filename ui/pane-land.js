// Where an agent's step lands on the owner's page (ui/live.js): ui/pane-route.js works it out from whom each tab
// follows, whose each pane is and where the reader is busy (ui/pane-busy.js), and this does it: a pane of the tab in
// sight drawn again or split, a tab brought into sight, a tab in the background given the step and marked (decision
// e_xjrpyysn), a tab of its own opened, or the window a tab was popped out into moved. A pane a session's step lands in
// is held for it (`held`), kept with the tab, so its next step goes there again, however long it works.

import { hooks } from './base.js';
import { busy, windowOf } from './pane-busy.js';
import { route, sessionOf, SHOWN, WATCH } from './pane-route.js';
import { activeId, drawn, flash, goPane, markPanes, only, openPane, paneAt, place } from './panes.js';
import { arrived, drawStrip, openTab, toFront } from './tab-bar.js';
import { chatTab, revive, takeOver } from './tab-life.js';
import { BLANK, drawable, focusOf, keep, landed, named, outTabs, poppedTab, tabOf, tabs } from './tabs.js';

/** The page starts its tabs through here (ui/app.js), so that where a step lands is loaded with them. */
export { startTabs } from './tab-bar.js';

/** An item's page, as a show names one: it opens over the pane that draws it when that pane is in focus. */
const itemOf = (at) => /^e\/(e_[a-z0-9]{8})(?:\?|$)/.exec(at)?.[1];

/** Land an agent's show where it goes: a pane, a tab in the background, a window of its own, or nowhere where no tab takes it. Answers 'later' when it is to be tried again. */
hooks.land = (step) => {
  if (poppedTab) return;
  const at = step.hash;
  // What the server says of a session, rather than what an agent asked to show, draws its canvas and opens no page.
  const page = step.canvas ? undefined : itemOf(at);
  const session = sessionOf(step);
  const now = Date.now();
  // The chat is heard from: a tab struck or closed for it is its own again; after a clear, the one before it is this one.
  if (step.takes) takeOver(step.takes, session);
  revive(session);
  const paneOf = (t, id, inSight) => ({
    id,
    slot: t.panes[id]?.slot,
    held: t.panes[id]?.held,
    focus: id === (inSight ? activeId() : focusOf(t)),
    landed: landed.get(`${t.id}:${id}`),
    busy: inSight && busy(id),
    draws: named(t.panes[id]?.at) === named(paneAt(at)),
    blank: t.panes[id]?.at === BLANK,
  });
  const docked = tabs.list.map((t) => ({ id: t.id, follows: t.follows ?? 'none', chat: t.chat, watches: watched(t), front: t.id === tabs.front, panes: t.groups.map((g) => paneOf(t, g, t.id === tabs.front)) }));
  const out = outTabs()
    .filter((t) => !tabOf(t.id) && windowOf(t.id))
    .map((t) => ({ id: t.id, follows: t.follows ?? 'none', popped: true, panes: [{ ...paneOf(t, focusOf(t), false), busy: busy(t.id) }] }));
  const to = route(step, [...docked, ...out], { drawable: drawable(at) });
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
    if (to.later) return 'later';
    if (to.open) {
      // A page that is no canvas opens over a blank tab, as one of its own open over its pane does.
      const id = openTab(drawable(at) ? `#/${at}` : BLANK, { ...chatTab(to.open.follows), ...(to.open.slot && { slot: to.open.slot }) }, to.front);
      const t = tabOf(id);
      if (page || !drawable(at)) ((t.sheet = page ? `e/${page}` : at.split('?')[0]), keep());
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
    // A blank pane taken for a name the show gave is that name's from now on.
    if (to.slot && t.panes[to.pane]) t.panes[to.pane].slot = to.slot;
    // A pane split for the session is its own, and closes as its chat ends (ui/tab-life.js).
    const split = () => openPane(at, to.split.side, t.groups.at(-1), { ...(!to.split.shared && { by: session }), ...(to.split.slot && { slot: to.split.slot }), ...(!to.split.slot && t.follows !== session && { held: session }) }, t);
    // Not a canvas (a screen, the workspace): the page opens over the tab's pane in focus.
    if (!drawable(at)) {
      if (to.front) toFront(t.id);
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
      if (page && pane === focusOf(t)) t.sheet = `e/${page}`;
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
    if (page && id === activeId()) location.hash = `#/e/${page}?${queryOf(t, id)}`;
    flash(id);
  } finally {
    if (step.watch) watchFrom(session);
    markPanes();
    drawStrip();
  }
};
/**
 * What tab `t` watches, when it watches: the items its panes draw, but for the one its sessions share. Read from the
 * canvases drawn while it is in sight, and kept with it for while it is not.
 */
function watched(t) {
  if (t.follows !== WATCH) return undefined;
  if (t.id === tabs.front) {
    const now = t.groups.filter((g) => t.panes[g]?.slot !== SHOWN).flatMap((g) => drawn.get(g)?.canvas?.ids?.() ?? []);
    if (now.length) ((t.watch = [...new Set(now)]), keep());
  }
  return t.watch ?? [];
}
/** Make the tab session `run` last landed in watch what it draws: the owner approved the plan shown, so it is theirs now. */
export function watchFrom(run) {
  const t = tabs.list.filter((o) => o.groups.some((g) => landed.get(`${o.id}:${g}`)?.session === run)).sort((a, b) => latest(b, run) - latest(a, run))[0];
  if (!t) return;
  watchTab(t);
}
const latest = (t, run) => Math.max(0, ...t.groups.map((g) => landed.get(`${t.id}:${g}`)).filter((l) => l?.session === run).map((l) => l.at));
/** Tab `t` watches what it draws from now on: the owner's, as a tab kept is (every pane theirs), following no one session. */
export function watchTab(t) {
  delete t.chat;
  delete t.ended;
  for (const g of t.groups) (delete t.panes[g].by, delete t.panes[g].held);
  Object.assign(t, { follows: WATCH, named: undefined, word: undefined });
  watched(t);
  keep();
}
hooks.watchTab = watchTab;

/** The lens query a pane of tab `t` stands at, for an item's page over it. */
const queryOf = (t, id) => (t.panes[id]?.at ?? '').split('?')[1] ?? '';
