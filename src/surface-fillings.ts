// The surface's slots the kernel's own modules fill (src/surface-slots.ts), by name: each until the step that moves
// its module into a pack (docs/kernel-packs.md, wave 2), which takes its line out of here and names it as a hook in
// the pack's manifest instead. This list only shrinks.

import { backupFile } from './backup-route.ts';
import { rechecked } from './recheck.ts';
import type { KernelFillings } from './surface-slots.ts';

export const KERNEL_FILLINGS: KernelFillings = {
  'surface.act': { rechecked },
  'surface.read': {},
  'surface.route': { backupFile },
};
