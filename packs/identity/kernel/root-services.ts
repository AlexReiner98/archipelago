// The identity root's services (docs/kernel-packs.md, "Root services"), called only by the packs packs/roots.json names
// for each: values in, values out.

import type { RootCall } from '../../loader/kernel/root-calls.ts';

/** root.workspaces: the workspaces this server holds, for a server duty that walks them all (the backup pack's). */
export async function workspacesOf(call: RootCall): Promise<{ id: string; name: string }[]> {
  if (!call.workspaces) throw new Error('root.workspaces is a server duty: no map asks it');
  return call.workspaces.list();
}
