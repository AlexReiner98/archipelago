// The surface's slots the kernel's own modules fill (src/surface-slots.ts), by name: each until the step that moves
// its module into a pack (docs/kernel-packs.md, wave 2), which takes its line out of here and names it as a hook in
// the pack's manifest instead. This list only shrinks. The reads (surface.reads) came here in wave 5 in place of the
// reads API's own imports of their modules, which a root may not make: each is loaded when first asked.

import { backupFile } from './backup-route.ts';
import { rechecked } from './recheck.ts';
import type { KernelFillings } from './surface-slots.ts';

const reads = () => import('./service-reads.ts');

export const KERNEL_FILLINGS: KernelFillings = {
  'surface.act': { rechecked },
  'surface.read': {},
  'surface.route': { backupFile },
  'surface.reads': {
    told: async (l, q) => (await reads()).told(l, q), // to usage, once uses.ts reads no kernel module
    touched: async (l, q) => (await reads()).touched(l, q), // sessions', an optional pack: a part of runs, not a read of its own
    events: async (l, q) => (await reads()).events(l, q), // to views, with eventlog
    view: async (l, q) => (await reads()).view(l, q), // to query, with views and askview
    placed: async (l, q) => (await reads()).placed(l, q), // to query, with timeaxis
  },
};
