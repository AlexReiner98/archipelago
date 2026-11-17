// Where an agent's show lands among the tabs, worked out with no page (the panes pack's part, task e_d5ewsvgf; tested
// by test/pane-route.test.ts). A tab is one canvas (Alex, 17 Nov 2026: no split panes).
// - Only a show lands. A change or a beat of a session's story moves nothing (the owner, 29 Oct 2026, e_e7yfp2yg).
// - A show goes to the tab that follows its session, else to a tab of its own, opened out of sight and marked. No tab
//   is brought into sight but by a show with `focus` (e_uh7qu8ts).
// - A tab the reader is busy in is never taken: the show waits.

/** Whose a step is: its session, when the server knows it, else the agent that took it. */
export const sessionOf = (step) => step.run ?? step.actor;

/**
 * Where this step goes. `tabs` are the tabs there are, each { id, follows: 'none' | <session>, front?, busy? }, `busy`
 * where the reader is at work in it. Answers { tab, front } to draw it there, { open: { follows }, front } to open a tab,
 * { later: true } to try again, or { nowhere: true } when no tab takes it; `front` says whether the tab is in sight,
 * brought there only by a step with `focus`.
 */
export function route(step, tabs) {
  const session = sessionOf(step);
  const focus = Boolean(step.focus);
  const own = tabs.find((t) => t.follows === session);
  if (own) return own.busy ? { later: true } : { tab: own.id, front: Boolean(own.front || focus) };
  // What the server says of a session (it began, it took up a task) opens no tab: a chat has one once it shows something.
  if (step.canvas) return { nowhere: true };
  return { open: { follows: session }, front: focus };
}
