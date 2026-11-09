// Where each step stands, read from what the picture draws (task e_ryv5h63g): its phase as the answer gives it
// (src/phases.ts), under way while something under way works on it; whether it waits on the person looking; whether
// an open step it depends on holds it up. A link is read by what it is a flavour of too (its `is`), so a pack's link
// that extends waits_on waits. Only what is drawn is read: a link the picture does not hold claims nothing, and a held
// one claims nothing until it is made. A run the answer gives a session (docs/sessions.md) carries its state, and waits
// on you where the style lights that state (`lit`, ./session.js), held up where it is blocked. Layer: marks. Pure: an
// answer in, each item's state out.

import { isOf } from './graph.js';

/** Whether a link is of a type, or a flavour of it: an older answer names its type as its kind. */
const isA = (l, type) => isOf({ type: l.type ?? l.kind, is: l.is }, type);

/** Each item's state: { phase, you, blocked, working, session? }. An older answer's own state is kept where it says more. */
export function statesOf({ items, links = [], viewer, lit = new Set() }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const open = (id) => byId.get(id)?.open !== false;
  const out = new Map(items.map((i) => [i.id, {
    phase: i.phase ?? (i.open === false ? 'finished' : 'not_started'),
    you: Boolean(i.state?.needs_you), blocked: Boolean(i.state?.blocked), working: Number(i.state?.sessions) > 0,
  }]));
  for (const i of items) {
    const state = i.session?.state, s = out.get(i.id);
    if (typeof state !== 'string') continue;
    s.session = state;
    if (lit.has(state)) s.you = true;
    if (state === 'blocked') s.blocked = true;
  }
  for (const l of links) {
    const from = out.get(l.from), to = out.get(l.to);
    if (!from || !to || l.pending || !open(l.from)) continue;
    if (isA(l, 'waits_on') && viewer && l.to === viewer) from.you = true;
    if (isA(l, 'depends_on') && open(l.to)) from.blocked = true;
    if (isA(l, 'works_on') && from.phase === 'under_way') to.working = true;
  }
  // A step something works on is under way, whatever its status says yet.
  for (const s of out.values()) if (s.working && s.phase === 'not_started') s.phase = 'under_way';
  return out;
}
