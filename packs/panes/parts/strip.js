// The strip of tabs as marks (the panes pack's part panes.tabs, slot `tabs`): what packs/panes/page/tab-bar.js draws,
// decided from the model (./model.js) and the sessions open now, drawn by the runtime. The owner's tabs first, then
// the chats', set apart by space; each tab its name and ×, and + ends the strip (Alex, 17 Nov 2026: no ⋯ menu).

import { closable, focusOf, frontOf, sessionOfTab } from './model.js';

const cut = (s, most = 200) => String(s ?? '').slice(0, most);

/** What a tab is called: the session it follows, else what its pane in focus draws, as its canvas named it. */
export function nameOfTab(t, sessions = {}) {
  const session = sessionOfTab(t);
  if (session) return { name: sessions[session]?.name ?? t.named ?? 'Session', session };
  const pane = t.panes[focusOf(t)];
  if (pane?.at?.startsWith('v?nothing=')) return { name: 'New tab' };
  return { name: pane?.name ?? 'Home' };
}

/** Whose a tab is, in its tooltip. */
const whom = (t) => (t.chat ? 'this chat’s tab: it closes as the chat ends' : 'yours');

function tabMark(m, t, sessions) {
  const { name, session } = nameOfTab(t, sessions);
  const inSight = t.id === m.front;
  const ended = t.chat && t.ended?.includes(t.chat);
  const s = sessions[session];
  const tip = [name, whom(t), ended && 'its chat has ended or gone quiet: it goes when you leave it'].filter(Boolean).join(' · ');
  return ['box', { key: `tab:${t.id}`, flow: 'row', gap: 2, selected: inSight, ...(t.unseen && !inSight && { ring: true }), ...(session && { hue: cut(sessions[session]?.word ?? t.word ?? t.named ?? session, 80) }), aux: closable(m, t), ...(ended && { tone: 'closed' }), tip: cut(tip) },
    // Its session's state, drawn by whichever pack fills tab.mark (the sessions pack's tab_count), handed this tab in words.
    ['slot', { key: `mark:${t.id}`, name: 'tab.mark', piece: { tab: t.id, current: m.front ?? '', ...(s?.state && { state: s.state }), ...(s?.for && { for: cut(s.for) }) } }],
    ['button', { key: `front:${t.id}`, look: 'tab', tip: cut(tip) }, cut(name, 80)],
    ...(closable(m, t) ? [['button', { key: `close:${t.id}`, look: 'quiet', tip: 'Close this tab' }, '×']] : []),
  ];
}

/** The strip: the owner's tabs, then the chats', then +. */
export function strip(m, { sessions = {} } = {}) {
  const all = [...m.list].sort((a, b) => Boolean(a.chat) - Boolean(b.chat));
  const marks = all.map((t) => tabMark(m, t, sessions));
  const firstChat = all.findIndex((t) => t.chat);
  if (firstChat > 0) marks.splice(firstChat, 0, ['box', { key: 'chats', pad: 2 }]);
  return ['box', { key: 'strip', flow: 'row', gap: 1, align: 'start', dock: true }, ...marks, ['button', { key: 'new', look: 'quiet', tip: 'New tab' }, '+']];
}
/** The tab in sight's name, for the page's title and the bar. */
export const frontName = (m, sessions) => nameOfTab(frontOf(m), sessions).name;
