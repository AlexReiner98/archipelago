// Where an agent's step lands among the panes of the owner's page (ui/panes.js), worked out from what each pane
// follows and nothing else, so it is tested without a page. A pane follows everyone (as the main one does unless the
// reader says), one session, or nobody (decisions e_622ev534, e_nwmx4tbd, e_y7uz9pk9):
// - A session's step goes to a pane that follows it: the one it named (`pane: "review"`), else the one it last landed in.
// - A pane named by a session that has none of that name is opened for it, following it.
// - Otherwise it goes to a pane that follows everyone and that no other session at work holds: the one already
//   drawing it, else the main one. A session holds such a pane while it lands there within `recent`.
// - When every such pane is held by another session at work, the session gets a pane of its own, following it.
// - Past `most` docked panes, or where the panes it may use follow someone else or nobody, it is only offered (the line).
// - A step that is not a show (a change, a beat of its story) moves no pane the session has not shown into: it lands in
//   the session's own, or in one it holds, or, while no other session is at work, where a show would; else it is
//   offered. A page left open is not taken by agents writing elsewhere.
// - A pane the reader is busy in is never taken. A show bound for it opens in a window of its own, popped out, as does
//   any pane opened while the reader is busy in a docked one, since docking it would squeeze theirs; a step that is
//   not a show is offered.

/** The words a show's `pane` places by, rather than names. */
export const SIDE_WORDS = new Set(['left', 'right', 'above', 'below', 'main', 'alone']);
/** Whose a step is: its session, when the server knows it, else the agent that took it. */
export const sessionOf = (step) => step.run ?? step.actor;

/** The sessions heard from while the page is open, by key: what to call each one, and when it last took a step. */
export const heard = new Map();
/** Hear a step: its session is among those a pane can follow, called by its name (the run's title), else by its agent's. */
export function hear(step) {
  const key = sessionOf(step);
  const name = step.name ?? step.actor.split(/[/:]/).at(-1);
  heard.set(key, { name, at: Math.max(step.at, heard.get(key)?.at ?? 0), run: step.run });
}
/** A session's name as a pane's picker says it: its own, or the agent's, with its run when another session goes by the same. */
export function nameOf(key) {
  const one = heard.get(key);
  if (!one) return key.startsWith('e_') ? key : key.split(/[/:]/).at(-1);
  const twin = [...heard].some(([k, o]) => k !== key && o.name === one.name);
  return twin && one.run ? `${one.name} · ${one.run.slice(-4)}` : one.name;
}

/**
 * Where this step goes. `panes` are the panes there are, the main one among them (id "main"), each
 * { id, follows: 'all' | 'none' | <session>, slot?, draws?, landed?: { session, at }, busy?, popped? }, with `draws`
 * true where the pane draws what the step names, `busy` where the reader is at work in it, and `popped` for one in a
 * window of its own. Answers { pane, side? } to draw it in a pane (moved to `side` when one is asked), { open:
 * { follows, slot?, side, popped? } } to open one (popped: in a window of its own), or { offer: true } to only offer
 * it. `others` is how many other sessions took a step within `recent`.
 */
export function route(step, panes, { now, recent, most, others = 0, drawable = true }) {
  const session = sessionOf(step);
  const show = step.kind === undefined || step.kind === 'show';
  const asked = step.pane;
  const slot = asked && !SIDE_WORDS.has(asked) ? asked : undefined;
  const side = asked && SIDE_WORDS.has(asked) ? asked : undefined;
  const docked = panes.filter((p) => !p.popped);
  const busy = docked.some((p) => p.busy);
  // A pane opened: docked beside the main one, unless that would squeeze a pane the reader is busy in.
  const opening = (open) => (!show || !drawable ? { offer: true } : busy ? { open: { ...open, popped: true } } : docked.length < most ? { open } : { offer: true });
  // A pane chosen: taken, unless the reader is busy in it.
  const into = (p, more) => (p.busy ? opening({ follows: session, ...(slot && { slot }), side: 'right' }) : { pane: p.id, ...more });
  const main = panes.find((p) => p.id === 'main');
  const takes = (p) => p.follows === 'all' || p.follows === session;
  const mine = panes.filter((p) => p.follows === session).sort((a, b) => (b.landed?.at ?? 0) - (a.landed?.at ?? 0));
  if (!show && others > 0) {
    const held = panes.filter((p) => p.follows === session || (p.follows === 'all' && p.landed?.session === session && now - p.landed.at < recent));
    const to = held.find((p) => !p.busy && (drawable || p.id === 'main'));
    return to ? { pane: to.id } : { offer: true };
  }
  // What only the main pane draws (a screen, the workspace's sheet) goes there, or is offered.
  if (!drawable) return main && takes(main) && !main.busy ? { pane: 'main' } : { offer: true };
  if (side === 'main' || side === 'alone') return main && takes(main) && !main.busy ? { pane: 'main', side } : { offer: true };
  if (slot) {
    const named = mine.find((p) => p.slot === slot);
    return named ? into(named) : opening({ follows: session, slot, side: 'right' });
  }
  const own = mine.find((p) => !p.slot) ?? mine[0];
  // A side asked for puts the session's pane there, or opens one there, as before there were sessions.
  if (side) return own && own.id !== 'main' && !own.popped ? into(own, { side }) : opening({ follows: session, side });
  if (own) return into(own);
  const heldByOther = (p) => p.landed && p.landed.session !== session && now - p.landed.at < recent;
  const open = panes.filter((p) => p.follows === 'all' && !heldByOther(p));
  const free = open.find((p) => p.landed?.session === session) ?? open.find((p) => p.draws) ?? open.find((p) => p.id === 'main') ?? open[0];
  if (free) return into(free);
  // Every pane that follows everyone is someone else's now: a pane of its own, if there are any that follow everyone.
  return panes.some((p) => p.follows === 'all') ? opening({ follows: session, side: 'right' }) : { offer: true };
}
