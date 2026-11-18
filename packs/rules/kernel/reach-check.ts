// What an op writes outside the reach of the pack or drawing that makes it, as the rule word when.reach reads it
// (./rules.ts). Kept apart from the judge so each file stays one thing.

import type { Registry } from '../../loader/kernel/packs.ts';
import { fieldInReach, inReach } from '../../loader/kernel/reach.ts';
import type { Target, Written } from './rules.ts';

/**
 * What an op writes outside a pack's reach, if anything: a type or link type it neither declares nor requires (nor
 * uses while that pack is active), or a field another pack outside its reach added to a type. Undefined when inside.
 */
export function outsideReach(reg: Registry, pack: string, w: Written, targets: Target[]): string | undefined {
  const types = w.op === 'create' || w.op === 'link' ? (w.type ? [w.type] : []) : targets.map((t) => t.type);
  for (const t of types) {
    if (!inReach(reg, pack, t)) return t;
    for (const field of Object.keys(w.props ?? {})) if (!fieldInReach(reg, pack, t, field)) return `${t} (its field ${field})`;
  }
  return undefined;
}

/** What an op a drawing asked for writes outside the types its style declares (flavours included), if anything: a link is always outside. */
export function outsideLayout(reg: Registry, writes: string[], w: Written, targets: Target[]): string | undefined {
  if (w.op === 'link' || w.op === 'unlink') return w.type ?? 'a link';
  const types = w.op === 'create' ? (w.type ? [w.type] : []) : targets.map((t) => t.type);
  if (!types.length) return w.type ?? 'an item it cannot find';
  return types.find((t) => !writes.some((x) => reg.isA(t, x)));
}
