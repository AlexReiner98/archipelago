// The strip of tabs as marks (the panes pack's part panes.tabs, slot `tabs`): what packs/panes/page/tab-bar.js draws,
// decided from the model (./model.js) and the sessions open now, drawn by the runtime. The owner's tabs first, then
// the chats', set apart by space; every tab the same controls, in sight or not: ⋯ (whom it follows, pop out, merge)
// and ×, and + ends the strip. A tab is dragged: onto another to merge, out of the page to pop out (`drag: 'tab'`).

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

/**
 * A session's state as its tab says it: a mark for what waits on the owner or is stuck, and its words with what it waits
 * for. Here until the sessions pack's part draws it in the slot tab.mark (task e_wmgpqayh), the same marks as
 * packs/sessions/parts/tab_count draws.
 */
const STATES = { waiting: { mark: '?', said: 'waits on you' }, your_move: { mark: '↩', said: 'your move' }, blocked: { mark: '⊘', said: 'blocked' }, working: { said: 'working' }, quiet: { said: 'quiet' }, idle: { said: 'idle' } };
export function stateSaid(s) {
  const st = STATES[s?.state];
  return st ? { mark: st.mark, said: [st.said, s.for].filter(Boolean).join(': ') } : null;
}

/** Whose a tab is, in its tooltip. */
const whom = (t, session) => (t.chat ? 'this chat’s tab: it closes as the chat ends' : session ? 'yours, following this chat' : 'yours');

function tabMark(m, t, sessions, out) {
  const { name, session } = nameOfTab(t, sessions);
  const inSight = t.id === m.front && !out;
  const ended = t.chat && t.ended?.includes(t.chat);
  const st = stateSaid(sessions[session]);
  const tip = [name, st?.said, whom(t, session), ended && 'its chat has ended or gone quiet: it goes when you leave it', out && 'in a window of its own: press to go to it', !out && !inSight && 'drag it out of the page to pop it out'].filter(Boolean).join(' · ');
  return ['box', { key: `tab:${t.id}`, flow: 'row', gap: 2, drag: 'tab', selected: inSight, ...(t.unseen && !inSight && { ring: true }), ...(session && { hue: cut(sessions[session]?.word ?? t.word ?? t.named ?? session, 80) }), aux: !out && closable(m, t), ...(ended && { tone: 'closed' }), tip: cut(tip) },
    ...(st?.mark ? [['text', { look: 'mark', tip: cut(st.said) }, st.mark]] : []),
    ['button', { key: `front:${t.id}`, look: 'tab', tip: cut(tip) }, cut(name, 80)],
    ...(out ? [] : [tabMenu(m, t, sessions)]),
    ...(!out && closable(m, t) ? [['button', { key: `close:${t.id}`, look: 'quiet', tip: 'Close this tab' }, '×']] : []),
  ];
}

/** The menu of tab `t`: whom it follows (nobody, the sessions in what it draws, each session open), keep, pop out, merge. */
export function tabMenu(m, t, sessions = {}) {
  const now = t.follows ?? 'none';
  const pick = (key, said, tip) => ['button', { key: `follow:${t.id}:${key}`, ...(key === now && { tone: 'accent' }), tip: cut(tip) }, cut(said, 80)];
  return ['menu', { key: `menu:${t.id}`, label: '⋯', look: 'quiet', tip: 'This tab: whom it follows, pop it out, merge' },
    pick('none', 'Nobody', 'No agent moves this tab'),
    pick('watch', 'Sessions in what it draws', 'Every session working on what this tab draws'),
    ...Object.entries(sessions).filter(([, s]) => !s.ended).map(([run, s]) => pick(run, s.name ?? run, run)),
    ...(t.chat ? [['button', { key: `keep:${t.id}`, tip: 'Make this tab yours: it stays when its chat ends' }, 'Keep']] : []),
    ...(m.list.length > 1 ? [['button', { key: `pop:${t.id}`, tip: 'Into a window of its own' }, 'Pop out']] : []),
    ...m.list.filter((o) => o !== t).map((o) => ['button', { key: `merge:${t.id}:${o.id}`, tip: 'Put this tab’s panes beside those of another' }, cut(`Merge into ${nameOfTab(o, sessions).name}`, 80)]),
  ];
}

/** The strip: the owner's tabs, then the chats' (and those popped out), then +. */
export function strip(m, { sessions = {}, out = [] } = {}) {
  const all = [...m.list.map((t) => [t, false]), ...out.map((t) => [t, true])].sort(([a], [b]) => Boolean(a.chat) - Boolean(b.chat));
  const marks = all.map(([t, o]) => tabMark(m, t, sessions, o));
  const firstChat = all.findIndex(([t]) => t.chat);
  if (firstChat > 0) marks.splice(firstChat, 0, ['box', { key: 'chats', pad: 2 }]);
  return ['box', { key: 'strip', flow: 'row', gap: 1, align: 'start', dock: true }, ...marks, ['button', { key: 'new', look: 'quiet', tip: 'New tab' }, '+']];
}

/** The tab in sight's name, for the page's title and the bar. */
export const frontName = (m, sessions) => nameOfTab(frontOf(m), sessions).name;
