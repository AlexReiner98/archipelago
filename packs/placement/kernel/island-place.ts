// Where a new item that names no island goes on a map with islands on (task e_b8k453zf). Moved from
// src/island-items.ts into the placement pack (task e_mhqvdzj6, docs/kernel-packs.md: `placeOnIslands` to placement);
// the island rules that check where it went stay with the loader (islandRefusals).

import type { KernelContext } from '#pelago/kernel';
import { type Item, itemOf, type Judged, type Op, type Reg, type Type } from './ops.ts';

/** Core's type of an island. */
const ISLAND = 'island';
/** The packs whose shared set any island speaks: core's (KERNEL_PACKS, src/packorder.ts). */
const KERNEL_PACKS = ['core'];
/** Whether items of a type live on an island: all but the kernel's own (the kernel flag) and actors (src/island-items.ts). */
const livesOnIsland = (t: { system: boolean; lineage: string[] }) => !t.system && !t.lineage.includes('actor');

/** How many islands the lone-island fallback reads. */
const ISLANDS_READ = 50;

/**
 * Where a new item that names no island goes, written into its op so the log says where it went.
 * First the island of what it is tied to in the same change: what it is part of, or else any link to an item on an
 * island of its pack (never a link that crosses, which reads another island's finding). So a map pack's action that
 * makes a test result part of a run puts it on the run's island. Failing that, the island the change was given (a
 * pack action's `island` input), and failing that the lone island it fits, when the map has exactly one (a new
 * workspace has its first: the owner, 10 Nov 2026, e_44rbfwxp, so a first change just works). With none that fits,
 * or several, it is left for the island rules (islandRefusals) to name them.
 */
export async function placeOnIslands(ctx: KernelContext, reg: Reg, ops: Op[], given?: string): Promise<void> {
  if (!reg.onIslands) return;
  const bare = new Set(ops.flatMap((op, i) => (op.op === 'create' && !op.props?.island && reg.type(op.type) && livesOnIsland(reg.type(op.type)!) ? [i] : [])));
  if (!bare.size) return;
  const shared = new Set(reg.packs.filter((p) => KERNEL_PACKS.includes(p.id)).flatMap((m) => m.shared ?? []));
  const crosses = new Set([...reg.relations.values()].filter((r) => (r as { crosses?: boolean }).crosses).map((r) => r.id));
  const partOf = reg.relationFamily('part_of');
  const made = new Map(ops.flatMap((op, i) => (op.op === 'create' && op.ref ? [[op.ref, i] as const] : [])));
  const fits = (t: Type, pack: string | null | undefined) => pack !== undefined && (t.pack === pack || shared.has(t.id));
  const packs = new Map<string, string | undefined>();
  /** The pack an island speaks, for an island by id or one made in this change as {ref}; none when it names no island. */
  const packOf = async (island: string) => {
    if (packs.has(island)) return packs.get(island);
    const ref = /^\{([^{}\s]+)\}$/.exec(island)?.[1];
    const op = ref !== undefined ? ops[made.get(ref) ?? -1] : undefined;
    const found: Pick<Item, 'type' | 'props' | 'archived_at'> | undefined = op?.op === 'create' ? { type: op.type, props: op.props ?? {}, archived_at: null } : ref === undefined ? await itemOf(ctx, island) : undefined;
    const pack = found && reg.isA(found.type, ISLAND) && !found.archived_at ? String(found.props?.pack ?? '') : undefined;
    packs.set(island, pack);
    return pack;
  };
  /** The island an end of a link lives on, as this change leaves it so far. */
  const islandOf = async (end: string): Promise<string | undefined> => {
    const i = made.get(end);
    if (i !== undefined) { const op = ops[i]; return op.op === 'create' ? (op.props?.island as string | undefined) : undefined; }
    return ((await itemOf(ctx, end))?.props?.island as string | undefined) ?? undefined;
  };
  const place = (i: number, island: string) => {
    const op = ops[i] as Extract<Op, { op: 'create' }>;
    // A copy of the op takes its place in the list: the caller's own object is not changed under it.
    ops[i] = { ...op, props: { ...op.props, island } };
    bare.delete(i);
  };
  /** The one island of these ends that the type fits, if there is exactly one. */
  const oneOf = async (type: Type, ends: string[]) => {
    const found = new Set<string>();
    for (const end of ends) { const island = await islandOf(end); if (island && fits(type, await packOf(island))) found.add(island); }
    return found.size === 1 ? [...found][0] : undefined;
  };

  // By its ties, again until nothing moves: a new run's island reaches the results made part of it in the same change.
  for (let moved = true; moved; ) {
    moved = false;
    for (const i of [...bare]) {
      const op = ops[i] as Extract<Op, { op: 'create' }>;
      if (!op.ref) continue;
      const type = reg.type(op.type)!;
      const ties = ops.filter((o): o is Extract<Op, { op: 'link' }> => o.op === 'link' && !crosses.has(o.type) && (o.from === op.ref || o.to === op.ref));
      const parents = ties.filter((o) => o.from === op.ref && partOf.includes(o.type)).map((o) => o.to);
      const island = (await oneOf(type, parents)) ?? (await oneOf(type, ties.map((o) => (o.from === op.ref ? o.to : o.from))));
      if (island) (place(i, island), (moved = true));
    }
  }
  if (!bare.size) return;
  // The island it was given: written even where it does not fit, so the refusal says why.
  if (given) { for (const i of [...bare]) place(i, given); return; }
  if (ops.some((op) => op.op === 'create' && reg.isA(op.type, ISLAND))) return;
  // The map's islands, oldest first: of core's type itself, as the kernel read them (a flavour of island is not one here).
  const { rows } = (await ctx.reads({ items: { type: ISLAND }, page: { size: ISLANDS_READ } })) as { rows: Item[] };
  const islands = rows.filter((r) => r.type === ISLAND).map((r) => ({ id: r.id, pack: (r.props?.pack as string | undefined) ?? null }));
  for (const i of [...bare]) {
    const type = reg.type((ops[i] as Extract<Op, { op: 'create' }>).type)!;
    const there = islands.filter((r) => fits(type, r.pack));
    if (there.length === 1) place(i, there[0].id);
  }
}

/** The filling of write.rewrite: each new item that names no island placed on one, in a copy of the ops; run after the subject's. */
export async function rewrite(ctx: KernelContext, ops: Op[], judged: Judged): Promise<Op[]> {
  const out = ops.slice();
  await placeOnIslands(ctx, judged.registry, out, judged.island);
  return out;
}
