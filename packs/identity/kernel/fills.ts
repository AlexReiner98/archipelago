// What the identity root fills of the slots the roots below it open (docs/kernel-packs.md, "Slots"; read by
// src/root-fills.ts), apart from a workspace's open (kernel/open.ts). Of the log's restore (src/backup.ts): the types a
// backup's workspace defined for itself, kept where the server looks for them; and, restored onto a Postgres server
// from the command line, the workspace listed in the default database and its members and tokens indexed there.
// Kept apart from open.ts: the restore reads this while src/backup.ts, which the log's open.ts imports, may still be
// loading (`node src/backup.ts restore`), so nothing here may lead back to it.

import type { RootRestored, RootRestoredTo } from '../../log/kernel/backup.ts';
import { addLocalType, addWorkspace } from './control.ts';
import { indexWorkspace } from './control-index.ts';

export const RESTORED: RootRestored = [
  async (tx, given) => { for (const def of (given.local_pack as { types?: { id: string }[] } | null)?.types ?? []) await addLocalType(tx, def); },
];

export const RESTORED_TO: RootRestoredTo = [
  async ({ control, id, name, db }) => {
    if (id !== 'default') await addWorkspace(control, { id, name });
    await indexWorkspace(control, id, db);
  },
];
