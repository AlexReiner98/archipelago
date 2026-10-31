// Held for you: the changes that wait for the owner's word before they apply. Home keeps one line that leads to the
// canvas of them (the owner, 31 Oct 2026: the canvas finds them, the item's sheet decides them, ui/item-held.js).

import { api, ask, h, tell } from './base.js';
import { canvasAt, savedCanvases } from './canvases.js';
import { gist, loadSchema, relations, typeTitle } from './words.js';

/** The kept canvas that draws what held changes touch (core.held, packs/core/pack.json). */
export const HELD_CANVAS = 'core.held';

/** What a held change does, in a few words: the one thing it does, when it does one; else why it was asked for. */
export function said(p, names) {
  if (p.ops.length !== 1) return gist(p.reason);
  const [o] = p.ops;
  const name = (id) => names.get(id)?.title ?? 'an item';
  if (o.op === 'create') return `New ${typeTitle(o.type).toLowerCase()}: ${o.title}`;
  if (o.op === 'update') return o.visibility === 'public' ? `Make "${name(o.id)}" public` : o.status ? `Set "${name(o.id)}" to ${o.status}` : `Change "${name(o.id)}"`;
  if (o.op === 'archive') return `Archive "${name(o.id)}"`;
  if (o.op === 'link') return `Link "${name(o.from)}" ${relations.get(o.type)?.title ?? o.type} "${name(o.to)}"`;
  if (o.op === 'define_type') return `New type: ${o.type.title}`;
  return gist(p.reason);
}

/**
 * Decide a held change on the person's word: Apply at once, or Decline with a why they may leave out (the agent that
 * asked is told it). Answers whether it was decided; a refusal is said, and the change stays held.
 */
export async function decide(p, yes, { except, ops } = {}) {
  const note = yes ? undefined : await ask({ title: 'Decline this change?', message: gist(p.reason), input: { placeholder: 'Why not? (optional, told to whoever asked)' }, action: 'Decline', danger: true });
  if (!yes && note === null) return false;
  try {
    await api('decide', { proposal: p.id, approve: yes, note: note || undefined, except, ops });
    if (yes && (ops ?? p.ops).some((o) => o.op === 'define_type')) await loadSchema();
    return true;
  } catch (err) {
    await tell('That was not done', err.message);
    return false;
  }
}

/** Home's line: how many changes wait, and the way to the canvas that draws them. Left out when none wait. */
export async function heldPiece(host, title) {
  const [pending, kept] = await Promise.all([api('proposals').catch(() => []), savedCanvases().catch(() => [])]);
  if (!host.isConnected) return;
  if (!pending.length) return host.remove();
  const canvas = kept.find((x) => x.id === HELD_CANVAS);
  const n = pending.length;
  host.replaceChildren(
    h(
      'div',
      { class: 'row-top needs', style: 'flex-wrap: nowrap; margin-bottom: var(--space-8)' },
      h('span', { class: 'n', style: 'flex: none' }, n),
      h('a', { class: 'grow', href: canvas ? canvasAt(canvas) : '#/', title: 'Draw what these changes would touch', style: 'min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis' }, `${title}: ${n} wait${n === 1 ? 's' : ''} for your word`),
    ),
  );
}
