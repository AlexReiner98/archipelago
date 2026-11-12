// What the write root fills of a workspace's open (src/lifecycle.ts): in the packs phase, once the loader has made the
// registry, the map and its one write path on it.

import type { RootOpen } from '../../identity/kernel/lifecycle.ts';
import { Archipelago } from './pelago.ts';

export const OPEN: RootOpen = {
  packs: [(o) => { o.pelago = new Archipelago(o.db, o.registry!, o.config.policy, o.id); }],
};
