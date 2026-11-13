// The sessions this page has heard from, and what each is called (packs/surface/page/live.js hears every step): the count
// of sessions waiting on the owner beside the tabs names them so. Where a show lands is the panes part's own rule
// (packs/panes/parts/route.js), worked out with no page.

/** Whose a step is: its session, when the server knows it, else the agent that took it. */
export const sessionOf = (step) => step.run ?? step.actor;

/** The sessions heard from while the page is open, by key: what to call each one, and when it last took a step. */
export const heard = new Map();
/**
 * Hear a step: its session is among those a tab can follow, called by what its chat is called (`title`, the run's, which
 * follows a rename), else by its agent's name. `name` is its word, never shown: the key to its hue (ui/words.js).
 */
export function hear(step) {
  const key = sessionOf(step);
  const agent = step.actor.split(/[/:]/).at(-1);
  const was = heard.get(key);
  heard.set(key, { name: step.name ?? was?.name ?? agent, called: step.title ?? step.label ?? was?.called ?? agent, at: Math.max(step.at, was?.at ?? 0), run: step.run, ended: step.ends ? true : step.opens ? false : was?.ended, quiet: was?.quiet });
}
/**
 * Hear the sessions open now (the `sessions` view): one this page has heard nothing from can be followed too, and one
 * not among them has ended. It stays heard, since a tab or a pane may still name it, but its word can be another's now.
 */
export function hearOpen(open) {
  const now = new Set(open.map((s) => s.id));
  for (const [key, one] of heard) if (key.startsWith('e_')) one.ended = !now.has(key);
  for (const s of open) {
    const was = heard.get(s.id);
    heard.set(s.id, { name: s.name ?? was?.name ?? s.title, called: s.title, at: Math.max(Date.parse(s.last_seen), was?.at ?? 0), run: s.id, ended: false, quiet: Boolean(s.stale) });
  }
}
/** Whom a tab can follow, newest first: the sessions not ended, and an agent at work with no session of its own, within `recent`. */
export function followable({ now, recent }) {
  const can = ([key, one]) => !one.ended && (key.startsWith('e_') || now - one.at < recent);
  return [...heard].filter(can).sort(([, a], [, b]) => b.at - a.at).map(([key]) => key);
}
/** A session as a tab or a pane says it: what it is called, with its run when another session goes by the same. */
export function nameOf(key) {
  const one = heard.get(key);
  if (!one) return key.startsWith('e_') ? key : key.split(/[/:]/).at(-1);
  // Only another run is a twin: a step heard by its agent before its run was known is the same session under another key.
  const twin = [...heard].some(([k, o]) => k !== key && o.run && o.run !== one.run && !o.ended && o.called === one.called);
  return twin && one.run ? `${one.called} · ${one.run.slice(-4)}` : one.called;
}
