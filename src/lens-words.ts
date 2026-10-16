// A lens in words: the rule a person reads on the page and an agent reads in the answer.

import type { Lens } from './lens.ts';
import type { Archipelago } from './pelago.ts';

/** A lens in words, so a person and an agent read the same rule: what is in the picture and what is not. */
export function sayLens(l: Archipelago, asked: Lens, startTitle: string | undefined): string {
  const link = (kind: string) => l.registry.relations.get(kind)?.title ?? kind;
  const parts = [asked.story ? `What "${startTitle}" told of, with the ties it drew` : startTitle ? `"${startTitle}" and what ${link(asked.by)} it` : `Everything, by what ${link(asked.by)} what`];
  if (asked.far !== undefined) parts.push(asked.far === 0 ? 'nothing below it' : `${asked.far} step${asked.far === 1 ? '' : 's'} down`);
  if (asked.kinds?.length) parts.push(`only ${asked.kinds.map((k) => (k.startsWith('-') ? `not ${k.slice(1)}` : k)).join(', ')}`);
  parts.push(asked.over === 'all' ? 'with every kind of link' : asked.over.length ? `with links: ${asked.over.map(link).join(', ')}` : 'with no links');
  if (asked.lanes) parts.push(`filed by ${asked.lanes.startsWith('field:') ? `its ${asked.lanes.slice(6).replaceAll('_', ' ')}` : asked.lanes}`);
  const out = asked.fold.map((f) => ({ closed: 'what is finished', system: 'the system\u2019s own records', unlinked: 'what is linked to nothing this way' })[f] ?? f);
  parts.push(out.length ? `without ${out.join(', ')}` : 'with nothing left out');
  if (asked.time) parts.push(`placed in time from ${asked.time.from} to ${asked.time.to}${asked.time.by?.length === 1 ? ` by its ${asked.time.by[0]}` : ''}`);
  return parts.join('; ') + '.';
}
