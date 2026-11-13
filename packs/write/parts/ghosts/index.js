// The write pack's part for held changes, filling the slot `ghosts`, which asks a decision: handed the changes held
// (`held`), the ids of the items drawn (`drawn`) and whether the canvas is one of what is held (`loose`), it answers
// with the ghosts, as data, for each thing a held change would add or change there. The part decides; the runtime
// checks them and draws each ghost where it draws anything (packs/surface/page/replica.js).

import { ghostsOf } from './ghosts.js';

/** What a held change says of itself on each ghost: which change, by whom, why, and what of it. */
const said = (pending) => ({ proposal: pending.proposal, ...(pending.by && { by: String(pending.by) }), ...(pending.reason && { reason: String(pending.reason) }), op: pending.op });

/** The ghosts for what is held: one for each item, link and mark a held change would draw. */
export function ghostList(input) {
  const drawn = new Set(Array.isArray(input?.drawn) ? input.drawn : []);
  const g = ghostsOf(Array.isArray(input?.held) ? input.held : [], (id) => drawn.has(id), Boolean(input?.loose));
  return [
    ...g.items.map((i) => ({ of: 'item', id: i.id, type: i.type, title: i.title, ...(i.status && { status: i.status }), ...(i.body && { body: i.body }), ...said(i.pending) })),
    ...g.links.map((l) => ({ of: 'link', id: l.id, type: l.type, from: l.from, to: l.to, ...said(l.pending) })),
    ...[...g.marks].flatMap(([on, all]) => all.map((p) => ({ of: 'mark', on, ...said(p) }))),
  ];
}

/** It draws nothing (no marks are sent): it is only asked. */
export default function ghosts() {
  return { decide: (input) => ghostList(input) };
}
