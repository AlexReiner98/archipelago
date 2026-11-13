// What the tab bar says of the sessions open now (task e_82rggead, docs/sessions.md): each session's tab carries a
// mark for its state, and the sessions waiting on the owner (`waiting`, `your_move`) are counted where every tab sees
// them, the oldest first. Pure: handed the `sessions` view's open runs, it answers what to draw. A run with no
// `session` (a server not wired yet) counts as nothing.

/** The states that wait on the owner. */
export const YOURS = ['waiting', 'your_move'];
/** A state's mark on its tab, and what it is called in a tooltip. A state with no mark draws none. */
export const STATES = {
  waiting: { mark: '?', said: 'waits on you' },
  your_move: { mark: '↩', said: 'your move' },
  blocked: { mark: '⊘', said: 'blocked' },
  working: { said: 'working' },
  quiet: { said: 'quiet' },
  idle: { said: 'idle' },
};

/** The open sessions waiting on the owner, the one waiting longest first. */
export const onYou = (open = []) =>
  open
    .filter((s) => YOURS.includes(s.session?.state))
    .sort((a, b) => (Date.parse(a.session.since) || 0) - (Date.parse(b.session.since) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** A session's state as its tab says it: its mark and its words, with what it waits for. */
export function stateSaid(session) {
  const st = STATES[session?.state];
  if (!st) return null;
  return { state: session.state, mark: st.mark, said: [st.said, session.for].filter(Boolean).join(': ') };
}

/** The count's tooltip: one line for each waiting on the owner, by its line, oldest first. */
export const countTip = (yours, nameOf) => yours.map((s) => `${STATES[s.session.state].mark} ${nameOf(s)}: ${s.session.line ?? STATES[s.session.state].said}`).join('\n');

/** Where a press on the count goes: the oldest one's tab (`chat` its own, else one following it), else its page. */
export function countGoes(yours, tabs) {
  const first = yours[0];
  if (!first) return null;
  const t = tabs.find((o) => o.chat === first.id) ?? tabs.find((o) => o.follows === first.id);
  return t ? { tab: t.id } : { page: `#/e/${first.id}` };
}
