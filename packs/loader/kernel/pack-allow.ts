// Which packs a workspace may have on this server: every pack it finds, unless the server names a list
// (PELAGO_ONLY_PACKS, or `packs` in pelago.config.json), and beside that list, the packs it lets one workspace alone
// have (PELAGO_WORKSPACE_PACKS, "islands=canvas,code;site=work", or `workspacePacks`). So a pack is offered to one map
// first and to every map later, each step a line of the server's configuration. A pack a workspace may not have is
// off there ("not enabled on this server"): its items stay, dormant, and its fact on the log is kept, so allowing it
// again brings it back as it was. Allowed, a pack the workspace never added is still off until its owner adds it.

import { KERNEL_PACKS } from './packorder.ts';

// The server's lists, read from its words, are the database root's, where its configuration is read.
export { readOnlyPacks, readWorkspacePacks } from '../../database/kernel/config-words.ts';

/** The packs one workspace may have: undefined for every pack; else the server's list, its own, and the kernel's. */
export function packsFor(only: string[] | undefined, perWorkspace: Record<string, string[]> | undefined, workspace: string): string[] | undefined {
  if (!only) return undefined;
  return [...new Set([...KERNEL_PACKS, ...only, ...(perWorkspace?.[workspace] ?? [])])];
}
