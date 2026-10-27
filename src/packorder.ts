// Which packs run, and in what order. A pack is active when it is on and every pack it requires is active; waiting
// when it is on but a pack it requires is not (it says which, and why); off when the owner turned it off here or the
// server does not enable it. A waiting or off pack registers nothing, and its items behave as dormant. The kernel's
// own packs are always on, and the server starts whatever state the others are in.

import type { PackFile } from './packs.ts';

export type PackState = { state: 'active' | 'waiting' | 'off'; why?: string };

/** The kernel's packs: the kinds and root relations, and the system tier. Never off. */
export const KERNEL_PACKS = ['core'];

/**
 * Put the packs found in load order and say the state of each. `off` is what is off, each with why. The workspace's own
 * pack ("local") requires nothing: it uses whichever packs are active, and a type of it that extends a type no
 * active pack has is left to the type table.
 */
export function orderPacks(found: Map<string, PackFile>, off: Map<string, string>, local: string): { ordered: PackFile[]; states: Map<string, PackState> } {
  const states = new Map<string, PackState>();
  const ordered: PackFile[] = [];
  const visit = (pack: PackFile, trail: string[]): PackState => {
    const known = states.get(pack.id);
    if (known) return known;
    if (off.has(pack.id) && !KERNEL_PACKS.includes(pack.id)) return set(pack, { state: 'off', why: off.get(pack.id) });
    if (trail.includes(pack.id)) return set(pack, { state: 'waiting', why: `in a cycle: ${[...trail, pack.id].join(' -> ')}` });
    if (pack.id !== local) {
      for (const dep of pack.requires ?? []) {
        const required = found.get(dep);
        const theirs = required ? visit(required, [...trail, pack.id]) : { state: 'missing' as const };
        if (theirs.state !== 'active') return set(pack, { state: 'waiting', why: `needs ${dep}, which is ${theirs.state === 'missing' ? 'not on this server' : theirs.state}` });
      }
    }
    ordered.push(pack);
    return set(pack, { state: 'active' });
  };
  const set = (pack: PackFile, state: PackState) => (states.set(pack.id, state), state);
  const core = found.get('core');
  if (!core) throw new Error('No core pack');
  visit(core, []);
  const rest = [...found.values()].filter((p) => p.id !== local).sort((a, b) => a.id.localeCompare(b.id));
  for (const pack of rest) visit(pack, []);
  if (found.has(local)) visit(found.get(local)!, []);
  return { ordered, states };
}
