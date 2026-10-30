// Where an agent's step lands among the owner's tabs and the panes in each (ui/tab-bar.js, ui/panes.js), worked out
// from whom each tab follows and whose each pane is, and nothing else, so it is tested without a page. A tab is a set of
// panes, every one alike, and follows everyone (as the first does unless the reader says), one session, or nobody (decisions
// e_622ev534, e_nwmx4tbd, e_y7uz9pk9; tabs: e_mzer5m4t, e_q3amet26, e_ezb7s3a7, e_xjrpyysn):
// - Only a show lands (ui/live.js sends no other). A change or a beat of a session's story moves nothing (the owner,
//   29 Oct 2026, e_e7yfp2yg): with several sessions at work, the reader's canvas stays where they left it.
// - A show goes to a tab that follows its session, else to one that follows everyone and no other session at work
//   holds: the one it holds already, else the one drawing it, else the one in sight. A session holds such a tab while
//   it lands there within `recent`. When every such tab is another's, the session gets a tab of its own, following it,
//   out of sight and marked; there is no most.
// - Within the tab: the pane it named (`pane: "review"`), opened beside the others if there is none; a side asked for
//   moves its pane there. Else its own pane: the one held for it (a pane keeps whose it is as long as it stands, so a
//   long session finds it again), else one drawing what it shows or one nobody holds, never the pane the reader is in
//   or touched last (the owner, 28 and 29 Oct 2026), else one split for it. In a tab that follows the session alone,
//   every pane is its own, and only there does `alone` close the others or a page that is not a canvas open over it:
//   elsewhere such a page gets a tab of its own, out of sight and marked.
// - No tab is brought into sight: a show into another tab draws it in the background and marks it.
// - A pane the reader is busy in is never taken, and no pane is split into a tab the reader is at work in: the show
//   goes to a tab of its own in the background instead.
// - A tab popped out into a window of its own is drawn in its canvas when it follows the session.

/** The words a show's `pane` places by, rather than names. */
export const SIDE_WORDS = new Set(['left', 'right', 'above', 'below', 'main', 'alone']);
/** Whose a step is: its session, when the server knows it, else the agent that took it. */
export const sessionOf = (step) => step.run ?? step.actor;

/** The sessions heard from while the page is open, by key: what to call each one, and when it last took a step. */
export const heard = new Map();
/** Hear a step: its session is among those a tab can follow, called by what its surface calls it, else by its name, else by its agent's. */
export function hear(step) {
  const key = sessionOf(step);
  const name = step.name ?? step.actor.split(/[/:]/).at(-1);
  heard.set(key, { name, label: step.label, called: step.label ?? (step.name ? `Session ${step.name}` : name), at: Math.max(step.at, heard.get(key)?.at ?? 0), run: step.run });
}
/** Hear the sessions open now (the `sessions` view): one this page has heard nothing from can be followed too. */
export function hearOpen(open) {
  for (const s of open) {
    if (heard.has(s.id)) continue;
    const called = s.label ?? (s.name ? `Session ${s.name}` : s.title);
    heard.set(s.id, { name: s.name ?? s.title, label: s.label, called, at: Date.parse(s.last_seen), run: s.id });
  }
}
/**
 * Whom a tab can follow, newest first: the sessions in `open` (ids; null when that could not be read: everyone heard)
 * and an agent at work with no session of its own, within `recent`. A session that has ended is left out.
 */
export function followable(open, { now, recent }) {
  const can = ([key, one]) => !open || open.has(key) || (!key.startsWith('e_') && now - one.at < recent);
  return [...heard].filter(can).sort(([, a], [, b]) => b.at - a.at).map(([key]) => key);
}
/** A session as a tab or a pane says it: what it is called, with its run when another session goes by the same. */
export function nameOf(key) {
  const one = heard.get(key);
  if (!one) return key.startsWith('e_') ? key : key.split(/[/:]/).at(-1);
  const twin = [...heard].some(([k, o]) => k !== key && o.called === one.called);
  return twin && one.run ? `${one.called} · ${one.run.slice(-4)}` : one.called;
}

/**
 * Where this step goes. `tabs` are the tabs there are, each { id, follows: 'all' | 'none' | <session>, front?, popped?,
 * panes }, `front` for the one in sight and `popped` for one in a window of its own; `panes` are its panes in order,
 * each { id, slot?, held?, focus?, draws?, busy?, landed?: { session, at } }, with `held` the session it is kept for,
 * `focus` on the one the reader last touched, `draws` true where it draws what the step names and `busy` where the
 * reader is at work in it. Answers { tab, pane, side?, front } to draw it in a pane (moved to `side` when one is
 * asked), { tab, split: { slot?, side }, side?, front } to split a pane into a tab, { open: { follows, slot? }, front }
 * to open a tab, or { nowhere: true } when no tab takes it; `front` says whether the tab is in sight, never brought there.
 */
export function route(step, tabs, { now, recent, drawable = true }) {
  const session = sessionOf(step);
  const asked = step.pane;
  const slot = asked && !SIDE_WORDS.has(asked) ? asked : undefined;
  const last = (t) => t.panes.map((p) => p.landed).filter(Boolean).sort((a, b) => b.at - a.at)[0];
  const lately = (l, within) => Boolean(l) && now - l.at < within;
  const working = (t) => t.panes.some((p) => p.busy);
  // A tab of its own is opened out of sight, marked for the reader to go to; the one in sight stays in sight.
  const ownTab = () => ({ open: { follows: session, ...(slot && { slot }) }, front: false });
  /** The pane of tab `t` this step is for: by the name or side asked, else the session's own, never the reader's in focus. */
  function paneIn(t) {
    const all = t.follows === session;
    const inFocus = t.panes.find((p) => p.focus) ?? t.panes[0];
    // A window of its own draws in its one canvas, and a page that is not a canvas opens over the pane in focus: only
    // in a tab that follows this session alone, else in a tab of its own.
    if (t.popped || !drawable) return all ? { pane: inFocus.id } : ownTab();
    if (slot) {
      const named = t.panes.find((p) => p.slot === slot);
      return named ? { pane: named.id } : { split: { slot, side: 'right' } };
    }
    // A pane nobody holds or named, never the one the reader is in or touched last.
    const free = (p) => (!p.held || p.held === session) && !p.slot && !p.focus && !p.busy;
    const mine = t.panes.find((p) => p.held === session && !p.focus) ?? (all ? inFocus : t.panes.find((p) => free(p) && p.draws) ?? t.panes.find(free));
    // Alone closes the other panes: only in a tab that follows this session alone.
    const side = asked && SIDE_WORDS.has(asked) && asked !== 'main' && (asked !== 'alone' || all) ? asked : undefined;
    const moved = side ? { side } : {};
    return mine ? { pane: mine.id, ...moved } : { split: { side: side && side !== 'alone' ? side : 'right' }, ...moved };
  }
  /** Into tab `t`, unless the reader is at work where it would go: then a tab of its own, in the background. */
  function into(t) {
    const at = paneIn(t);
    if (at.open) return at;
    const taken = at.split ? t.front && working(t) : t.panes.find((p) => p.id === at.pane)?.busy;
    if (taken) return ownTab();
    return { tab: t.id, ...at, front: Boolean(t.front) };
  }
  const own = tabs.filter((t) => t.follows === session).sort((a, b) => (last(b)?.at ?? 0) - (last(a)?.at ?? 0))[0];
  if (own) return into(own);
  // A pane of its own moved into a tab that follows someone else stays its own (ui/tab-bar.js); the reader's Nobody is kept.
  const holding = tabs.find((t) => !['all', 'none'].includes(t.follows) && !t.popped && t.panes.some((p) => p.held === session));
  if (holding) return into(holding);
  const heldByOther = (t) => !t.panes.some((p) => p.held === session) && lately(last(t), recent) && last(t).session !== session;
  const open = tabs.filter((t) => t.follows === 'all' && !t.popped && !heldByOther(t));
  const free = open.find((t) => t.panes.some((p) => p.held === session)) ?? open.find((t) => last(t)?.session === session) ?? open.find((t) => t.panes.some((p) => p.draws && !p.focus)) ?? open.find((t) => t.front) ?? open[0];
  if (free) return into(free);
  // Every tab that follows everyone is someone else's now: a tab of its own, if there are any that follow everyone.
  return tabs.some((t) => t.follows === 'all') ? ownTab() : { nowhere: true };
}
