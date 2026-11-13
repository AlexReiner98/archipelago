// Where an agent's show lands among the tabs and their panes, worked out with no page (the panes pack's part, task
// e_d5ewsvgf): the same rule packs/panes/page/pane-route.js keeps for the host, copied here because a part shares no code
// with the page. Kept alike by test/panes-route-part.test.ts.

/** Whom a tab follows when it watches what it draws (a plan the owner approved): every session working inside it. */
export const WATCH = 'watch';
/** The one pane beside a watched plan that its sessions' shows share. */
export const SHOWN = 'shown';

/** The words a show's `pane` places by, rather than names. */
export const SIDE_WORDS = new Set(['left', 'right', 'above', 'below', 'main', 'alone']);
/** Whose a step is: its session, when the server knows it, else the agent that took it. */
export const sessionOf = (step) => step.run ?? step.actor;

/**
 * Where this step goes. `tabs` are the tabs there are, each { id, follows: 'none' | 'watch' | <session>, chat?, watches?,
 * front?, popped?, panes }, `watches` the ids a tab that watches draws and `chat` the session a chat's tab was opened for; `front` for the one in sight and `popped` for one in a window of its own; `panes` are its panes in order,
 * each { id, slot?, held?, by?, focus?, draws?, blank?, busy?, landed?: { session, at } }, with `held` the session it is kept for, `by` the one it was made for,
 * `focus` on the one the reader last touched, `draws` true where it draws what the step names, `blank` where it has no
 * query and `busy` where the reader is at work in it. Answers { tab, pane, slot?, side?, front } to draw it in a pane
 * (named `slot` when it takes a blank one for that name, moved to `side` when one is asked), { tab, split: { slot?, side }, side?, front } to split a pane into a tab, { open: { follows, slot? }, front }
 * to open a tab, { later: true } to try again, or { nowhere: true } when no tab takes it; `front` says whether the tab
 * is in sight, brought there only by a step with `focus`.
 */
export function route(step, tabs, { drawable = true } = {}) {
  const session = sessionOf(step);
  const asked = step.pane;
  const slot = asked && !SIDE_WORDS.has(asked) ? asked : undefined;
  const last = (t) => t.panes.map((p) => p.landed).filter(Boolean).sort((a, b) => b.at - a.at)[0];
  const working = (t) => t.panes.some((p) => p.busy);
  const focus = Boolean(step.focus);
  // A tab of its own is opened out of sight, marked for the reader to go to; the one in sight stays in sight.
  const ownTab = () => ({ open: { follows: session, ...(slot && { slot }) }, front: focus });
  /** The pane of tab `t` this step is for: by the name or side asked, else the session's own, never the reader's in focus. */
  function paneIn(t) {
    const all = t.follows === session;
    const inFocus = t.panes.find((p) => p.focus) ?? t.panes[0];
    // A window of its own draws in its one canvas, and a page that is not a canvas opens over the pane in focus: only
    // in a tab that follows this session alone, else in a tab of its own.
    if (t.popped || !drawable) return all ? { pane: inFocus.id } : ownTab();
    // A blank pane (a new tab's, a split's: no query) is taken before one is split beside it, the reader's in focus too:
    // it draws nothing to lose.
    const blank = t.panes.find((p) => p.blank && !p.busy && !p.slot && (!p.held || p.held === session) && (!p.by || p.by === session));
    if (slot) {
      const named = t.panes.find((p) => p.slot === slot);
      return named ? { pane: named.id } : blank ? { pane: blank.id, slot } : { split: { slot, side: 'right' } };
    }
    // A pane nobody holds or named, never the one the reader is in or touched last.
    const free = (p) => (!p.held || p.held === session) && (!p.by || p.by === session) && !p.slot && !p.focus && !p.busy;
    const mine = t.panes.find((p) => (p.held === session || p.by === session) && !p.focus) ?? (all ? inFocus : t.panes.find((p) => free(p) && p.draws) ?? blank ?? t.panes.find(free));
    // Alone closes the other panes: only in a tab that follows this session alone.
    const side = asked && SIDE_WORDS.has(asked) && asked !== 'main' && (asked !== 'alone' || all) ? asked : undefined;
    const moved = side ? { side } : {};
    return mine ? { pane: mine.id, ...moved } : { split: { side: side && side !== 'alone' ? side : 'right' }, ...moved };
  }
  /** Into tab `t`, unless the reader is at work where it would go: then a tab of its own, in the background, or if `t` is that tab, later. */
  function into(t) {
    const at = paneIn(t);
    if (at.open) return at;
    const taken = at.split ? t.front && working(t) : t.panes.find((p) => p.id === at.pane)?.busy;
    if (taken) return t.follows === session ? { later: true } : ownTab();
    return { tab: t.id, ...at, front: Boolean(t.front || (focus && !t.popped)) };
  }
  /**
   * Into tab `t`, which watches what the session works inside: the plan's own pane is never taken, since it draws the
   * session on its step; a show goes to the one pane beside it the plan's sessions share, taken from a blank one or split.
   */
  function intoWatched(t) {
    if (!drawable) return ownTab();
    if (t.popped) return { nowhere: true };
    const shared = t.panes.find((p) => p.slot === SHOWN);
    const blank = t.panes.find((p) => p.blank && !p.busy && !p.slot);
    const at = shared ? { pane: shared.id } : blank ? { pane: blank.id, slot: SHOWN } : { split: { slot: SHOWN, side: 'right', shared: true } };
    const taken = at.split ? t.front && working(t) : t.panes.find((p) => p.id === at.pane)?.busy;
    if (taken) return { later: true };
    return { tab: t.id, ...at, front: Boolean(t.front || focus) };
  }
  // A session working on anything a tab watches, or drawn there itself, is the watched plan's: no tab of its own.
  const inside = [session, ...(step.within ?? [])];
  const watching = tabs.find((t) => t.follows === WATCH && t.watches?.some((id) => inside.includes(id)));
  const own = tabs.filter((t) => t.follows === session).sort((a, b) => (last(b)?.at ?? 0) - (last(a)?.at ?? 0))[0];
  // A tab the owner set to follow the session comes first; one opened for its chat gives way to the plan it works in.
  if (own && !(watching && own.chat === session)) return into(own);
  if (watching) return step.canvas ? { nowhere: true } : intoWatched(watching);
  // A pane of its own the owner merged into another tab: its shows find it there, and no tab of its own is opened.
  const holding = !step.opens && tabs.find((t) => !t.popped && t.panes.some((p) => p.held === session || p.by === session));
  if (holding) return into(holding);
  // What the server says of a session (it began, it took up a task) opens no tab: a chat has one once it shows something.
  if (step.canvas) return { nowhere: true };
  return ownTab();
}
