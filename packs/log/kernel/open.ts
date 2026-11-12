// What the log root fills of a workspace's open (src/lifecycle.ts, read in the order packs/roots.json starts the roots):
// in the restore phase, what a backup brings.

import type { RootOpen } from '../../identity/kernel/lifecycle.ts';
import { restore } from './backup.ts';

export const OPEN: RootOpen = {
  restore: [async (o) => { if (o.backup) await restore(o.db, o.backup, o.id); }],
};
