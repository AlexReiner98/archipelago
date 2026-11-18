// The chats at work, as a part of the island side bar (./island-picker.js; decision e_mnuthcap, Alex, 17 Nov 2026): one
// row a chat, its state a mark before its name and what it works on after, those waiting on the owner first, as the
// sessions view orders them.
// A press opens the chat's page. They were tabs, which went on 18 Nov 2026.

import { h, hooks } from './base.js';
import { YOURS } from './sessions-open.js';

/** The mark for a session's state: what waits on the owner the inbox (by its class), one at work a dot, one blocked a square, one resting none. */
const MARKS = { working: '•', blocked: '■' };
const markOf = (state) => (YOURS[state] ? '' : (MARKS[state] ?? ''));

/** What a session works on, as the sessions view names it: the first, and how many more. */
const onOf = (s) => (Array.isArray(s.working_on) ? s.working_on.filter((w) => w?.id) : []);

/**
 * A chat's row: its mark, its name cut short, and what it works on after it, quieter (e_vr7tpgxp: who is on a task,
 * seen where it stands). Pointing at it lights that work on the canvas in sight (hooks.lights, ./bar-band.js); its
 * line or state is in the tooltip.
 */
function row(s, done) {
  const state = s.session?.state ?? 'idle';
  const said = s.session?.line || YOURS[state]?.said || state;
  const name = s.title ?? s.label ?? s.name ?? s.id;
  const on = onOf(s);
  const onSaid = on.length ? `${on[0].title}${on.length > 1 ? ` + ${on.length - 1}` : ''}` : '';
  const tip = `${name}${onSaid ? `, on ${onSaid}` : ''}: ${said}`;
  const el = h('div', { class: 'isl-row isl-chat', role: 'listitem', 'data-id': s.id, 'data-state': state, title: tip },
    // What waits on the owner is the inbox, the page's one mark for it (inbox.svg); the rest a glyph.
    h('span', { class: `isl-chat-mark${YOURS[state] ? ' on-you' : ''}`, 'aria-hidden': 'true' }, markOf(state)),
    h('button', { type: 'button', class: 'isl-name', tabindex: '-1', 'aria-label': tip, onclick: () => ((location.hash = `#/e/${s.id}`), done()) }, name),
    ...(onSaid ? [h('span', { class: 'isl-chat-on' }, onSaid)] : []));
  if (on.length) {
    el.addEventListener('pointerenter', () => hooks.lights?.(on.map((w) => w.id)));
    el.addEventListener('pointerleave', () => hooks.lights?.(null));
  }
  return el;
}

/** The Sessions part of the side bar, or nothing when no chat is open. */
export function sessionsPart(open, done) {
  if (!open.length) return [];
  return [h('div', { class: 'isl-sec isl-sec-chats' }, h('div', { class: 'isl-head' }, `Sessions · ${open.length}`), h('div', { role: 'list' }, ...open.map((s) => row(s, done))))];
}
