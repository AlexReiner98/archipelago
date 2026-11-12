// Which packs a workspace may have on this server: every pack it finds, unless the server names a list
// (PELAGO_ONLY_PACKS, or `packs` in pelago.config.json), and beside that list, the packs it lets one workspace alone
// have (PELAGO_WORKSPACE_PACKS, "islands=canvas,code;site=work", or `workspacePacks`). So a pack is offered to one map
// first and to every map later, each step a line of the server's configuration. A pack a workspace may not have is
// off there ("not enabled on this server"): its items stay, dormant, and its fact on the log is kept, so allowing it
// again brings it back as it was. Allowed, a pack the workspace never added is still off until its owner adds it.

import { KERNEL_PACKS } from './packorder.ts';

const list = (text: string) => text.split(',').map((p) => p.trim()).filter(Boolean);

/** The server's list of packs, read from PELAGO_ONLY_PACKS: unset or empty, every pack. */
export function readOnlyPacks(said: string | undefined): string[] | undefined {
  return said?.trim() ? list(said) : undefined;
}

/** The packs each workspace may have beyond the server's list, read from "ws=a,b;other=c". */
export function readWorkspacePacks(said: string | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of (said ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) {
      if (part.trim()) throw new Error(`PELAGO_WORKSPACE_PACKS: "${part.trim()}" names no workspace (workspace=pack,pack).`);
      continue;
    }
    const ws = part.slice(0, at).trim();
    if (!ws) throw new Error(`PELAGO_WORKSPACE_PACKS: "${part.trim()}" names no workspace (workspace=pack,pack).`);
    out[ws] = [...new Set([...(out[ws] ?? []), ...list(part.slice(at + 1))])];
  }
  return out;
}

/** The packs one workspace may have: undefined for every pack; else the server's list, its own, and the kernel's. */
export function packsFor(only: string[] | undefined, perWorkspace: Record<string, string[]> | undefined, workspace: string): string[] | undefined {
  if (!only) return undefined;
  return [...new Set([...KERNEL_PACKS, ...only, ...(perWorkspace?.[workspace] ?? [])])];
}
