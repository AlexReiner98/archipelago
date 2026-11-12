// The loader root's services (docs/kernel-packs.md, "Root services"), called only by the packs packs/roots.json names
// for each: values in, values out.

import { loadServerPacks } from './server-packs.ts';
import type { RootCall } from './root-calls.ts';

/** What the owner is shown of one server pack: what it may ask for, its public pages and entries, its webhooks. */
export interface ServerPackShown { id: string; title?: string; version: string; acts: string[]; pages: string[]; entries: string[]; webhooks: string[] }

/** root.server_packs: the server packs this server's folders hold, each as the owner is shown it, and those left out with why (the connect pack's). */
export async function serverPacksShown(_call: RootCall): Promise<{ packs: ServerPackShown[]; refused: { folder: string; why: string[] }[] }> {
  const { packs, refused } = loadServerPacks();
  return {
    packs: packs.map(({ file }) => ({ id: file.id, title: file.title, version: file.version, acts: file.reach.server.acts ?? [], pages: (file.reach.server.pages ?? []).map((p) => p.id), entries: (file.reach.server.entries ?? []).map((e) => e.id), webhooks: (file.reach.webhooks ?? []).map((w) => w.id) })),
    refused,
  };
}
