// The chats at work, as a part of the island side bar (./island-picker.js; decision e_mnuthcap, Alex, 17 Nov 2026): one
// row a chat, those waiting on the owner first, as the sessions view orders them. A press opens the chat's page. They
// were tabs, which went on 18 Nov 2026.
// A row is drawn from pieces (./session-pieces.js; task e_g5r2rzg6): its state's mark, its name, what it works on, the
// inbox, each a module of its own, in the order the style sets. This file names none of them.

import { h, hooks } from './base.js';
import { pieces, piecesOf } from './session-pieces.js';

/** A piece as the row draws it: a button where it opens the chat, else a span, painted in its hue. */
function drawn(p, opens, tip) {
  const attrs = { class: ['isl-piece', `isl-piece-${p.name}`, p.cls].filter(Boolean).join(' '), 'data-piece': p.name, style: p.hue ? `--session-hue: ${p.hue}` : null };
  if (p.opens) return h('button', { ...attrs, type: 'button', tabindex: '-1', 'aria-label': tip, onclick: opens }, p.word ?? '');
  return h('span', { ...attrs, ...(p.word == null && { 'aria-hidden': 'true' }) }, p.word ?? p.mark ?? '');
}

/**
 * Fill a chat's row from what its pieces say: each drawn in order, its tooltip the name and each piece's line under it,
 * and pointing at it lights the work the pieces name (hooks.lights, ./bar-band.js).
 */
function fill(el, s, reads, done) {
  const said = piecesOf(s, reads);
  const name = said.find((p) => p.opens)?.word ?? s.title ?? s.id;
  const tip = [name, ...said.filter((p) => !p.opens && p.tip).map((p) => p.tip)].join('\n');
  el.title = tip;
  el.dataset.state = s.session?.state ?? 'idle';
  const opens = () => ((location.hash = `#/e/${s.id}`), done());
  el.replaceChildren(...said.map((p) => drawn(p, opens, tip.replaceAll('\n', ', '))));
  const lit = [...new Set(said.flatMap((p) => (Array.isArray(p.lights) ? p.lights : [])))];
  el.onpointerenter = lit.length ? () => hooks.lights?.(lit) : null;
  el.onpointerleave = lit.length ? () => hooks.lights?.(null) : null;
}

/** A chat's row, filled as soon as its pieces have loaded (at once, after the first). */
function row(s, reads, done) {
  const el = h('div', { class: 'isl-row isl-chat', role: 'listitem', 'data-id': s.id, 'data-state': s.session?.state ?? 'idle' });
  void reads.then((r) => fill(el, s, r, done));
  return el;
}

/** The Sessions part of the side bar, or nothing when no chat is open. */
export function sessionsPart(open, done) {
  if (!open.length) return [];
  const reads = pieces();
  return [h('div', { class: 'isl-sec isl-sec-chats' }, h('div', { class: 'isl-head' }, `Sessions · ${open.length}`), h('div', { role: 'list' }, ...open.map((s) => row(s, reads, done))))];
}
