// A session's state on its tab, as the sessions pack's part (task e_z5kcqj3c, from ui/tab-count.js). The host hands
// each tab it draws as the slot tab.mark's piece, in words, as a piece's settings are: `tab` and `current` (the tab and
// the one in sight), and, where the tab is a session's, its `state` and what it waits `for`, as the `sessions` view last
// answered. This answers the tab's mark: `?` where it waits on the owner, `↩` where it is their move, `⊘` where it is
// blocked, with its words in the tip; nothing for any other state, or for the owner's own tab.

import { stateSaid } from './state.js';

/** The tone each state's mark takes. */
const TONE = { waiting: 'accent', your_move: 'accent', blocked: 'bad' };

/** A tab's mark, or nothing where its session's state draws none. */
function marksOf(input) {
  const piece = input?.piece ?? {};
  const st = typeof piece.state === 'string' ? stateSaid({ state: piece.state, ...(typeof piece.for === 'string' && { for: piece.for }) }) : null;
  if (!st?.mark) return ['box', {}];
  return ['text', { look: 'mark', tone: TONE[st.state], tip: st.said.slice(0, 200) }, st.mark];
}

export default function tabCount(input) {
  return {
    marks: marksOf(input),
    update: (next) => marksOf(next),
  };
}
