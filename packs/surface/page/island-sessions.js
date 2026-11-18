// The chats at work, as a part of the island side bar (./island-picker.js; decision e_mnuthcap, Alex, 17 Nov 2026): one
// row a chat, its state a mark before its name, those waiting on the owner first, as the sessions view orders them.
// A press opens the chat's page. They were tabs; the tabs go once this and the island a show adds have taken their place.

import { h } from './base.js';
import { YOURS } from './sessions-open.js';

/** The mark for a session's state: what waits on the owner the inbox (by its class), one at work a dot, one blocked a square, one resting none. */
const MARKS = { working: '•', blocked: '■' };
const markOf = (state) => (YOURS[state] ? '' : (MARKS[state] ?? ''));

/** A chat's row: its mark, its name cut short, its line or state in the tooltip. */
function row(s, done) {
  const state = s.session?.state ?? 'idle';
  const said = s.session?.line || YOURS[state]?.said || state;
  const name = s.title ?? s.label ?? s.name ?? s.id;
  return h('div', { class: 'isl-row isl-chat', role: 'listitem', 'data-id': s.id, 'data-state': state },
    // What waits on the owner is the inbox, the page's one mark for it (inbox.svg); the rest a glyph.
    h('span', { class: `isl-chat-mark${YOURS[state] ? ' on-you' : ''}`, 'aria-hidden': 'true' }, markOf(state)),
    h('button', { type: 'button', class: 'isl-name', tabindex: '-1', title: `${name}: ${said}`, onclick: () => ((location.hash = `#/e/${s.id}`), done()) }, name));
}

/** The Sessions part of the side bar, or nothing when no chat is open. */
export function sessionsPart(open, done) {
  if (!open.length) return [];
  return [h('div', { class: 'isl-sec isl-sec-chats' }, h('div', { class: 'isl-head' }, `Sessions · ${open.length}`), h('div', { role: 'list' }, ...open.map((s) => row(s, done))))];
}
