// Linking an item from its page, as marks (task e_4qxxsh3n; from the host's link-pick.js and item-links.js). Link
// waits for the item clicked on the canvas (a button that picks a link); Link to one by name finds one as the canvas's
// search does (an item input that links). Either way the host tells the part the item and the ways it may be linked;
// with one way it is linked at once, with more the person picks the way. A link is a change on the person's word.

import { label } from './words.js';

/** A way to link, as the host says it: { type, from, to, title? }, from this item or to it. */
const wayOk = (w, id) => w && typeof w.type === 'string' && (w.from === id || w.to === id);

/** The link op for a way between `id` and the item picked. */
export const linkOp = (id, other, way) => ({ op: 'link', type: way.type, from: way.from ?? id, to: way.to ?? other });

/** The ways the host offers between this item and the one picked, each read from this one's end. */
export function waysOf(id, picked) {
  return (Array.isArray(picked?.ways) ? picked.ways : []).filter((w) => wayOk(w, id) || (w && typeof w.type === 'string' && !w.from && !w.to));
}

/** What links it: the button that picks on the canvas, and, while one is picked, the ways to choose from. */
export function linkMarks({ finding = false, picked } = {}) {
  if (picked?.ways?.length > 1) {
    return ['box', { look: 'sunk', flow: 'column', gap: 1, pad: 2, key: 'link-ways' },
      ['text', {}, `Link to ${picked.title ?? picked.id}:`],
      ['input', { key: 'link-way', kind: 'pick', values: ['', ...picked.ways.map((_, i) => String(i))], names: ['…', ...picked.ways.map((w) => w.verb ?? label(w.type))], value: '' }],
      ['button', { key: 'link-cancel', look: 'quiet' }, 'Cancel']];
  }
  if (finding) return ['box', { flow: 'row', gap: 1, key: 'link-find' }, ['input', { key: 'link-name', kind: 'item', link: true, hint: 'Link to one by name', focus: true, grow: true }], ['button', { key: 'link-cancel', look: 'quiet' }, 'Cancel']];
  return null;
}

/**
 * What a gesture on linking comes to: `{ ops, reason }` a link made, `{ choose: picked }` ways to pick from,
 * `{ finding: true|false }`, or null when it is not linking's. `picked` is the item waiting for a way.
 */
export function linkEvent(event, item, picked) {
  const k = event?.key;
  if (k === 'link-start' && event.name === 'picked') return event.value ? chosen(item, event.value) : { finding: false };
  if (k === 'link-name' && event.name === 'pick') return chosen(item, event.value);
  if (k === 'link-cancel' && event.name === 'press') return { finding: false, choose: null };
  if (k === 'link-by-name' && event.name === 'press') return { finding: true };
  if (k === 'link-way' && event.name === 'pick' && picked) {
    const way = picked.ways[Number(event.value)];
    return way ? { ops: [linkOp(item.id, picked.id, way)], reason: `Linked in the UI: ${way.verb ?? way.type}`, choose: null } : null;
  }
  return null;
}

function chosen(item, picked) {
  if (!picked?.id || picked.id === item.id) return { finding: false };
  const ways = waysOf(item.id, picked);
  if (ways.length === 1) return { ops: [linkOp(item.id, picked.id, ways[0])], reason: `Linked in the UI: ${ways[0].verb ?? ways[0].type}`, finding: false };
  if (!ways.length) return { finding: false, said: `No link can join it to ${picked.title ?? picked.id}` };
  return { choose: { id: picked.id, title: picked.title, ways }, finding: false };
}
