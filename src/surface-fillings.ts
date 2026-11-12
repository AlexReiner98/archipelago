// The surface's slots the kernel's own modules fill (src/surface-slots.ts), by name: each until the step that moves
// its module into a pack (docs/kernel-packs.md, wave 2), which takes its line out of here and names it as a hook in
// the pack's manifest instead. This list only shrinks, but for one kind of line: a service pack's module that still
// takes the map rather than its context (moved with a shim in src/), split off a root so the root no longer holds it.
// It is named here, through its shim, until it runs on its context and its manifest names it.
// - check_connections: the connect pack's (wave 5, bug e_wpww27fm), out of the write root's class.

import { backupFile } from './backup-route.ts';
import { check_connections } from './check-connections.ts';
import { rechecked } from './recheck.ts';
import type { KernelFillings } from './surface-slots.ts';

export const KERNEL_FILLINGS: KernelFillings = {
  'surface.act': { rechecked, check_connections },
  'surface.read': {},
  'surface.route': { backupFile },
};
