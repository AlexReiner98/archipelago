// The write pack's part for held changes (slot `ghosts`, declared in its manifest once the frame offers it): handed the changes held (`held`), the ids of the items drawn
// (`drawn`) and whether the canvas is one of what is held (`loose`), it answers with a ghost mark for each thing a held
// change would add or change there. The part decides; the runtime draws each ghost where it draws anything.

import { ghostsOf } from './ghosts.js';

/** What a held change says of itself on each ghost: which change, by whom, why, and what of it. */
const said = (pending) => ({ proposal: pending.proposal, ...(pending.by && { by: String(pending.by) }), ...(pending.reason && { reason: String(pending.reason) }), op: pending.op });

/** The marks for what is held: a list of ghosts, one for each item, link and mark a held change would draw. */
export function ghostMarks(input) {
  const drawn = new Set(Array.isArray(input?.drawn) ? input.drawn : []);
  const g = ghostsOf(Array.isArray(input?.held) ? input.held : [], (id) => drawn.has(id), Boolean(input?.loose));
  return [
    'list',
    {},
    ...g.items.map((i) => ['ghost', { of: 'item', id: i.id, type: i.type, title: i.title, ...(i.status && { status: i.status }), ...(i.body && { body: i.body }), ...said(i.pending) }]),
    ...g.links.map((l) => ['ghost', { of: 'link', id: l.id, type: l.type, from: l.from, to: l.to, ...said(l.pending) }]),
    ...[...g.marks].flatMap(([on, all]) => all.map((p) => ['ghost', { of: 'mark', on, ...said(p) }])),
  ];
}

export default function ghosts(input) {
  return { marks: ghostMarks(input), update: (next) => ghostMarks(next) };
}
