// Where an agent's step lands among the panes of the owner's page (ui/panes.js), worked out from what each pane
// follows and nothing else, so it is tested without a page. A pane follows everyone (as the main one does unless the
// reader says), one session, or nobody (decisions e_622ev534, e_nwmx4tbd, e_y7uz9pk9):
// - A session's step goes to a pane that follows it: the one it named (`pane: "tests"`), else the one it last landed in.
// - A pane named by a session that has none of that name is opened for it, following it.
// - Otherwise it goes to a pane that follows everyone and that no other session at work holds: the one already
//   drawing it, else the main one. A session holds such a pane while it lands there within `recent`.
// - When every such pane is held by another session at work, the session gets a pane of its own, following it.
// - Past `most` panes, or where the panes it may use follow someone else or nobody, it is only offered (the line).

/** The words a show's `pane` places by, rather than names. */
export const SIDE_WORDS = new Set(['left', 'right', 'above', 'below', 'main', 'alone']);
/** Whose a step is: its session, when the server knows it, else the agent that took it. */
export const sessionOf = (step) => step.run ?? step.actor;

/** The sessions heard from while the page is open, by key: what to call each one, and when it last took a step. */
export const heard = new Map();
/** Hear a step: its session is among those a pane can follow. Two sessions of one agent are told apart by their run. */
export function hear(step) {
  const key = sessionOf(step);
  const name = step.actor.split(/[/:]/).at(-1);
  heard.set(key, { name, at: Math.max(step.at, heard.get(key)?.at ?? 0), run: step.run });
}
/** A session's name as a pane's picker says it: the agent's, with its run when another session goes by the same. */
export function nameOf(key) {
  const one = heard.get(key);
  if (!one) return key.startsWith('e_') ? key : key.split(/[/:]/).at(-1);
  const twin = [...heard].some(([k, o]) => k !== key && o.name === one.name);
  return twin && one.run ? `${one.name} · ${one.run.slice(-4)}` : one.name;
}

/**
 * Where this step goes. `panes` are those docked, the main one among them (id "main"), each
 * { id, follows: 'all' | 'none' | <session>, slot?, draws?, landed?: { session, at } }, with `draws` true where the pane
 * draws what the step names. Answers { pane, side? } to draw it in a pane (moved to `side` when one is asked), { open:
 * { follows, slot?, side } } to open one, or { offer: true } to only offer it.
 */
export function route(step, panes, { now, recent, most, drawable = true }) {
  const session = sessionOf(step);
  const asked = step.pane;
  const slot = asked && !SIDE_WORDS.has(asked) ? asked : undefined;
  const side = asked && SIDE_WORDS.has(asked) ? asked : undefined;
  const room = drawable && panes.length < most;
  const main = panes.find((p) => p.id === 'main');
  const takes = (p) => p.follows === 'all' || p.follows === session;
  // What only the main pane draws (a screen, the workspace's sheet) goes there, or is offered.
  if (!drawable) return main && takes(main) ? { pane: 'main' } : { offer: true };
  if (side === 'main' || side === 'alone') return main && takes(main) ? { pane: 'main', side } : { offer: true };
  const mine = panes.filter((p) => p.follows === session).sort((a, b) => (b.landed?.at ?? 0) - (a.landed?.at ?? 0));
  if (slot) {
    const named = mine.find((p) => p.slot === slot);
    if (named) return { pane: named.id };
    return room ? { open: { follows: session, slot, side: 'right' } } : { offer: true };
  }
  const own = mine.find((p) => !p.slot) ?? mine[0];
  // A side asked for puts the session's pane there, or opens one there, as before there were sessions.
  if (side) return own && own.id !== 'main' ? { pane: own.id, side } : room ? { open: { follows: session, side } } : { offer: true };
  if (own) return { pane: own.id };
  const heldByOther = (p) => p.landed && p.landed.session !== session && now - p.landed.at < recent;
  const open = panes.filter((p) => p.follows === 'all' && !heldByOther(p));
  const free = open.find((p) => p.landed?.session === session) ?? open.find((p) => p.draws) ?? open.find((p) => p.id === 'main') ?? open[0];
  if (free) return { pane: free.id };
  // Every pane that follows everyone is someone else's now: a pane of its own, if there are any that follow everyone.
  return room && panes.some((p) => p.follows === 'all') ? { open: { follows: session, side: 'right' } } : { offer: true };
}
