// What the identity root fills of a workspace's open (src/lifecycle.ts): in the restore phase, after the log has
// restored a backup, the indexes beside the workspaces told of its members and tokens, so they can sign in here.

import { indexWorkspace } from './control-index.ts';
import type { RootOpen } from './lifecycle.ts';

export const OPEN: RootOpen = {
  restore: [async (o) => { if (o.backup) await indexWorkspace(await o.control(), o.id, o.db); }],
};
