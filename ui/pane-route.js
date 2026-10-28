// Where an agent's step lands among the owner's tabs and the panes in each (ui/tab-bar.js, ui/panes.js), worked out
// from whom each tab follows and whose each pane is, and nothing else, so it is tested without a page. A tab is a set of
// panes, every one alike, and follows everyone (as the first does unless the reader says), one session, or nobody (decisions
// e_622ev534, e_nwmx4tbd, e_y7uz9pk9; tabs: e_mzer5m4t, e_q3amet26, e_ezb7s3a7, e_xjrpyysn):
// - A session's step goes to a tab that follows it, else to one that follows everyone and no other session at work
//   holds: the one it holds already, else the one drawing it, else the one in sight. A session holds such a tab while
//   it lands there within `recent`. When every such tab is another's, the session gets a tab of its own, following it;
//   there is no most.
// - Within the tab: the pane it named (`pane: "review"`), opened beside the others if there is none; a side asked for
//   moves its pane there. Else its own pane: the one held for it (a pane keeps whose it is as long as it stands, so a
//   long session finds it again), else one drawing what it shows or one nobody holds, never the pane in focus (the
//   reader may be at work there beside it, the owner, 28 Oct 2026), else one split for it. In a tab that follows the
//   session alone, every pane is its own.
// - A tab is brought into sight unless the reader is at work in the one in sight, or another session showed there
//   within `settle`; then it is drawn in the background and marked.
// - A pane the reader is busy in is never taken, and no pane is split into a tab the reader is at work in: a show goes
//   to a tab of its own in the background instead, a step that is not a show is offered.
// - A step that is not a show (a change, a beat of its story) moves no tab the session has not shown into while others
//   are at work, never opens one and never brings one into sight. A page left open is not taken by agents writing elsewhere.
// - A tab popped out into a window of its own is drawn in its canvas.

/** The words a show's `pane` places by, rather than names. */
export const SIDE_WORDS = new Set(['left', 'right', 'above', 'below', 'main', 'alone']);
/** Whose a step is: its session, when the server knows it, else the agent that took it. */
export const sessionOf = (step) => step.run ?? step.actor;

/** The sessions heard from while the page is open, by key: what to call each one, and when it last took a step. */
export const heard = new Map();
/** Hear a step: its session is among those a tab can follow, called by its name (the run's title), else by its agent's. */
export function hear(step) {
  const key = sessionOf(step);
  const name = step.name ?? step.actor.split(/[/:]/).at(-1);
  heard.set(key, { name, at: Math.max(step.at, heard.get(key)?.at ?? 0), run: step.run });
}
/** A session's name as a tab says it: its own, or the agent's, with its run when another session goes by the same. */
export function nameOf(key) {
  const one = heard.get(key);
  if (!one) return key.startsWith('e_') ? key : key.split(/[/:]/).at(-1);
  const twin = [...heard].some(([k, o]) => k !== key && o.name === one.name);
  return twin && one.run ? `${one.name} · ${one.run.slice(-4)}` : one.name;
}

/**
 * Where this step goes. `tabs` are the tabs there are, each { id, follows: 'all' | 'none' | <session>, front?, popped?,
 * panes }, `front` for the one in sight and `popped` for one in a window of its own; `panes` are its panes in order,
 * each { id, slot?, held?, focus?, draws?, busy?, landed?: { session, at } }, with `held` the session it is kept for,
 * `focus` on the one the reader last touched, `draws` true where it draws what the step names and `busy` where the
 * reader is at work in it. Answers { tab, pane, side?, front } to draw it in a pane (moved to `side` when one is
 * asked), { tab, split: { slot?, side }, side?, front } to split a pane into a tab, { open: { follows, slot? }, front }
 * to open a tab, or { offer: true } to only offer it; `front` says whether the tab is then in sight. `others` is how
 * many other sessions took a step within `recent`.
 */
export function route(step, tabs, { now, recent, settle, others = 0, drawable = true }) {
  const session = sessionOf(step);
  const show = step.kind === undefined || step.kind === 'show';
  const asked = step.pane;
  const slot = asked && !SIDE_WORDS.has(asked) ? asked : undefined;
  const side = asked && SIDE_WORDS.has(asked) ? asked : undefined;
  const last = (t) => t.panes.map((p) => p.landed).filter(Boolean).sort((a, b) => b.at - a.at)[0];
  const lately = (l, within) => Boolean(l) && now - l.at < within;
  const seen = tabs.find((t) => t.front);
  const working = (t) => t.panes.some((p) => p.busy);
  // In sight: the tab that is, or another, unless the reader is at work in the one in sight or another session just showed there.
  const upfront = (t) => !t.popped && (Boolean(t.front) || !seen || (!working(seen) && !(lately(last(seen), settle) && last(seen).session !== session)));
  const offer = { offer: true };
  const ownTab = (front) => (show ? { open: { follows: session, ...(slot && { slot }) }, front } : offer);
  /** The pane of tab `t` this step is for: by the name or side asked, else the session's own, never the reader's in focus. */
  function paneIn(t) {
    const inFocus = t.panes.find((p) => p.focus) ?? t.panes[0];
    // A window of its own draws in its one canvas; a page that is not a canvas opens over the pane in focus.
    if (t.popped || !drawable) return { pane: inFocus.id };
    if (slot) {
      const named = t.panes.find((p) => p.slot === slot);
      return named ? { pane: named.id } : { split: { slot, side: 'right' } };
    }
    const all = t.follows === session;
    // A pane nobody holds or named: the one in focus only when it draws this already, so nothing there changes.
    const free = (p) => (!p.held || p.held === session) && !p.slot;
    const mine = t.panes.find((p) => p.held === session) ?? (all ? inFocus : t.panes.find((p) => free(p) && p.draws) ?? t.panes.find((p) => free(p) && !p.focus && !p.busy));
    const moved = side && side !== 'main' ? { side } : {};
    return mine ? { pane: mine.id, ...moved } : { split: { side: moved.side && moved.side !== 'alone' ? moved.side : 'right' }, ...moved };
  }
  /** Into tab `t`, unless the reader is at work where it would go: then a tab of its own, in the background. */
  function into(t) {
    const at = paneIn(t);
    const taken = at.split ? t.front && working(t) : t.panes.find((p) => p.id === at.pane)?.busy;
    if (taken) return ownTab(t.popped ? upfront({}) : false);
    if (at.split && !show) return offer;
    return { tab: t.id, ...at, front: show ? upfront(t) : Boolean(t.front) };
  }
  if (!show && others > 0) {
    const holds = (t) => t.follows === session || (t.follows === 'all' && ((lately(last(t), recent) && last(t).session === session) || t.panes.some((p) => p.held === session)));
    const held = tabs.filter(holds).sort((a, b) => (last(b)?.at ?? 0) - (last(a)?.at ?? 0))[0];
    return held ? into(held) : offer;
  }
  const own = tabs.filter((t) => t.follows === session).sort((a, b) => (last(b)?.at ?? 0) - (last(a)?.at ?? 0))[0];
  if (own) return into(own);
  const heldByOther = (t) => !t.panes.some((p) => p.held === session) && lately(last(t), recent) && last(t).session !== session;
  const open = tabs.filter((t) => t.follows === 'all' && !heldByOther(t));
  const free = open.find((t) => t.panes.some((p) => p.held === session)) ?? open.find((t) => last(t)?.session === session) ?? open.find((t) => t.panes.some((p) => p.draws)) ?? open.find((t) => t.front) ?? open[0];
  if (free) return into(free);
  // Every tab that follows everyone is someone else's now: a tab of its own, if there are any that follow everyone.
  return tabs.some((t) => t.follows === 'all') ? ownTab(upfront({})) : offer;
}
