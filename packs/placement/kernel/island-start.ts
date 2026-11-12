// Islands on a map that has work on it, and on a new map from its start (the owner, 10 Nov 2026, decision e_44rbfwxp:
// islands always on). A new workspace is made with one island, named after it and speaking core, so an agent's first
// change has somewhere to go. A map with items turns islands on only if no pack in use would be switched off by the
// island rules (src/islands.ts), which would leave its work dormant; then every item that lives on an island and is on
// none is moved onto a new one, in one change, so it is in the log and undone as one.
//
// Moved from src/island-start.ts into the placement pack (docs/kernel-packs.md, "Where each module goes"). What it
// reads goes through the reads API (islands_off, held_types, unplaced, workspace_name); the change it makes is handed
// in by the caller, made as whoever turned islands on (or the server, for a new map's first island), as it was before.

import type { KernelContext } from '#pelago/kernel';

/** Core's type of an island. */
const ISLAND = 'island';
/** The packs whose shared set any island speaks: core's (KERNEL_PACKS, src/packorder.ts). */
const KERNEL_PACKS = ['core'];
/** Whether items of a type live on an island: all but the kernel's own (the kernel flag) and actors (src/island-items.ts). */
const livesOnIsland = (t: { system: boolean; lineage: string[] }) => !t.system && !t.lineage.includes('actor');

/** How many items one read takes when moving a map's work onto islands (UNPLACED, src/packreads-service.ts). */
const PAGE = 500;

/** An op this module makes. */
export type IslandOp =
  | { op: 'create'; ref?: string; type: string; title: string; status: string; visibility: 'shared'; props: { pack: string } }
  | { op: 'update'; id: string; props: { island: string } };
/** A change made for this module, by the one its caller names. */
export type MakeChange = (input: { reason: string; ops: IslandOp[] }) => Promise<unknown>;

type Reads = Pick<KernelContext, 'reads' | 'registry'>;

/** Why this map cannot be held to the island rules as it is, or nothing: a pack in use the rules would switch off. */
export async function islandBlockers(ctx: Reads): Promise<string | undefined> {
  const { off } = (await ctx.reads({ islands_off: true })) as { off: [string, string][] };
  for (const [pack, why] of off) {
    const types = [...ctx.registry.types.values()].filter((t) => t.pack === pack).map((t) => t.id);
    if (!types.length) continue;
    if (((await ctx.reads({ held_types: types })) as string[]).length) return `Islands would switch off the pack ${pack}, and this map has items of its types: ${why}. Take that pack out, or archive its items, first.`;
  }
  return undefined;
}

/** The live items that live on an island and are on none, with their types, a page at a time: once, when islands are turned on. */
async function unplaced(ctx: Reads): Promise<{ id: string; type: string }[]> {
  const types = [...ctx.registry.types.values()].filter(livesOnIsland).map((t) => t.id);
  const out: { id: string; type: string }[] = [];
  for (let after = ''; ; ) {
    const rows = (await ctx.reads({ unplaced: { types, after } })) as { id: string; type: string }[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    after = rows[rows.length - 1].id;
  }
}

/**
 * Move every item on no island onto islands: one for each pack their types are of (the shared set's go on the first),
 * or one speaking core. Each is named after the workspace, with its pack's name when there are several. The change is
 * made by `change`: as the one who turned islands on.
 */
export async function moveOntoIslands(ctx: Reads, change: MakeChange): Promise<{ islands: number; moved: number }> {
  const items = await unplaced(ctx);
  if (!items.length) return { islands: 0, moved: 0 };
  const shared = new Set(ctx.registry.packs.filter((p) => KERNEL_PACKS.includes(p.id)).flatMap((m) => m.shared ?? []));
  const packOf = (type: string) => (shared.has(type) ? undefined : ctx.registry.type(type)?.pack);
  const packs = [...new Set(items.map((i) => packOf(i.type)).filter((p): p is string => Boolean(p)))];
  if (!packs.length) packs.push('core');
  const name = (await ctx.reads({ workspace_name: true })) as string;
  const titleOf = (pack: string) => (packs.length === 1 ? name : `${name}: ${ctx.registry.packs.find((p) => p.id === pack)?.title ?? pack}`);
  const ops: IslandOp[] = packs.map((pack, i) => ({ op: 'create', ref: `island${i}`, type: ISLAND, title: titleOf(pack), status: 'current', visibility: 'shared', props: { pack } }));
  for (const item of items) ops.push({ op: 'update', id: item.id, props: { island: `{island${Math.max(0, packs.indexOf(packOf(item.type) ?? packs[0]))}}` } });
  await change({ reason: 'Islands turned on: what was on the map moves onto islands', ops });
  return { islands: packs.length, moved: items.length };
}

/** A new workspace's first island, named after it and speaking core: made by the server as the workspace is, through `change`. */
export async function firstIsland(change: MakeChange, name: string): Promise<void> {
  await change({ ops: [{ op: 'create', type: ISLAND, title: name, status: 'current', visibility: 'shared', props: { pack: 'core' } }], reason: 'A new workspace starts on islands' });
}
