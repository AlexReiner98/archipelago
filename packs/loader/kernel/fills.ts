// What the loader root fills of the slots the roots below it open (docs/kernel-packs.md, "Slots"; read by
// packs/database/kernel/root-fills.ts), apart from a workspace's open (kernel/open.ts). Of the log's reads of the past (packs/log/kernel/rebuild.ts,
// asOf): a map's registry as it stood at a fact position.

import type { RootPast } from '../../log/kernel/rebuild.ts';
import { Registry } from './packs.ts';
import { registryAt, takeItemsAt } from './registry-at.ts';

export const PAST: RootPast = {
  at: (q, today, pos) => (today instanceof Registry ? registryAt(q, today, pos) : Promise.resolve(undefined)),
  items: takeItemsAt,
};
