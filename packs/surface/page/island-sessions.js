// The chats at work, as a part of the island side bar (./island-picker.js; decision e_mnuthcap, Alex, 17 Nov 2026): one
// row a chat, its state a mark before its name, those waiting on the owner first, as the sessions view orders them.
// A press opens the chat's page. They were tabs, which went on 18 Nov 2026.

import { h, state as page } from './base.js';
import { YOURS } from './sessions-open.js';

/**
 * A session's state as the canvas marks it: the shape and colour the style names for it (session_marks, the sessions
 * pack's), drawn by ./island-picker.css, so the bar and the canvas never mark one state two ways. None where it names none.
 */
const markOf = (state) => {
  const s = page.style?.session_marks?.[state];
  return s && typeof s === 'object' ? { shape: /^[a-z]+$/.test(s.shape) ? s.shape : 'disc', hue: /^[a-z]+$/.test(s.hue ?? '') ? s.hue : 'text' } : null;
};

/** A chat's row: its mark, its name cut short, its line or state in the tooltip. */
function row(s, done) {
  const state = s.session?.state ?? 'idle';
  const said = s.session?.line || YOURS[state]?.said || state;
  const name = s.title ?? s.label ?? s.name ?? s.id;
  const mark = markOf(state);
  return h('div', { class: 'isl-row isl-chat', role: 'listitem', 'data-id': s.id, 'data-state': state },
    h('span', { class: 'isl-chat-mark', 'aria-hidden': 'true', ...(mark && { 'data-shape': mark.shape, style: `--isl-mark: var(--ln-${mark.hue})` }) }),
    h('button', { type: 'button', class: 'isl-name', tabindex: '-1', title: `${name}: ${said}`, onclick: () => ((location.hash = `#/e/${s.id}`), done()) }, name));
}

/** The Sessions part of the side bar, or nothing when no chat is open. */
export function sessionsPart(open, done) {
  if (!open.length) return [];
  return [h('div', { class: 'isl-sec isl-sec-chats' }, h('div', { class: 'isl-head' }, `Sessions · ${open.length}`), h('div', { role: 'list' }, ...open.map((s) => row(s, done))))];
}
