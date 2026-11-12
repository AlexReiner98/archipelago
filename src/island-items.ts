// An item lives on one island (task e_xgpnmgp6; decisions e_a7zuqqhz, e_mu8py3tf, e_e77fbbse, e_bb62j7gj). On a map
// with the setting `islands` on, an island is an item of core's type `island`, holding the pack it speaks; many islands
// may speak one pack, below a project or across projects (e_a2bpang8). Every other item lives on exactly one island,
// kept on it as its field `island` (a fact in the log like any field: no entry changes form), but for the kernel's own
// types and actors, which live on none and are linked from anywhere. Checked on write: a new item names its island, its
// type is the island's pack's or of the shared set, and no link joins items on two islands but one of a link type
// marked `crosses` (core's reading of a finding: findings are how islands meet). An island's pack is fixed once it is made. Off is the default: with the setting off, nothing here is asked.

import { sharedOf } from './islands.ts';
import { KERNEL_PACKS } from './packorder.ts';
import type { Archipelago } from './pelago.ts';
import type { Op } from './pelago-types.ts';
import type { FieldDef, Registry, ResolvedType } from './packs.ts';

/** Core's type of an island, and the field of an item that names the one it lives on. */
export const ISLAND = 'island';

/** The field the kernel declares, with islands on, on every type that lives on an island. */
export const ISLAND_FIELD: FieldDef = { type: 'string', description: 'The island it lives on, by id: on a map with islands on, every item but the kernel’s own and actors lives on one, and its type is that island’s pack’s or of the shared set.' };

/** Whether items of a type live on an island: all but the kernel's own (the kernel flag) and actors. */
export const livesOnIsland = (t: { system: boolean; lineage: string[] }) => !t.system && !t.lineage.includes('actor');

/** Whether a type is named in an island's legend: one that lives on an island and extends a starter, never a starter by itself (the grammar packs build on), nor what is retired or gone. A drawing adds a starter only where an item uses it bare. */
export const typeOnLegend = (t: { system: boolean; lineage: string[]; retired?: boolean; dormant?: boolean }) => livesOnIsland(t) && t.lineage.length > 1 && !t.retired && !t.dormant;

/** Whether a link type is named in an island's legend: never the kernel's own (a claim, a session's work, a tie between actors), nor what is retired or gone. */
export const linkOnLegend = (r: { kernel?: boolean; retired?: boolean; dormant?: boolean }) => !r.kernel && !r.retired && !r.dormant;

/** Step 32 (src/migrate.ts): what lives on an island, read by the query term `island <island>`. */
export const ISLAND_INDEX = `create index if not exists entity_island on entity ((props->>'island')) where (props->>'island') is not null;`;

/** SQL that holds of an item (as e) on one of the islands in a parameter. */
export const onIslands = (param: string) => `e.props->>'island' = any(${param}::text[])`;

interface Where { island: string | null; title: string }

// Where a new item that names no island goes (placeOnIslands) is the placement pack's: src/island-place.ts.

/** Why ops break the island rules, as sentences; none when they keep them, or when the map has islands off. */
export async function islandRefusals(map: Archipelago, reg: Registry, ops: Op[]): Promise<string[]> {
  if (!reg.onIslands) return [];
  const errors: string[] = [];
  const shared = sharedOf(reg.packs.filter((p) => KERNEL_PACKS.includes(p.id))).types;
  const made = new Map<string, { type: string; props: Record<string, unknown>; title: string }>(); // ref -> what this change makes
  const moved = new Map<string, Where>(); // id or ref -> where this change puts it
  const cut = ops.flatMap((op) => (op.op === 'unlink' ? [op.relation] : [])); // links this change takes away
  const crosses = [...reg.relations.values()].filter((r) => (r as { crosses?: boolean }).crosses).map((r) => r.id); // the link types that may join two islands
  const fits = (t: ResolvedType, pack: string) => t.pack === pack || shared.has(t.id);
  const refs = new Set(ops.flatMap((op, i) => (op.op === 'create' ? [op.ref ?? `#${i + 1}`] : [])));
  /** An island as props.island names it, as the key this check reads: an island made in this change is named {ref}, which the apply loop turns into its id. */
  const islandKey = (value: unknown): unknown => {
    const braced = typeof value === 'string' ? /^\{([^{}\s]+)\}$/.exec(value) : null;
    return braced && refs.has(braced[1]) ? braced[1] : value;
  };
  /** Why props.island cannot be kept as it is written: a bare ref would be kept as it is, naming no island. */
  const bare = (where: string, value: unknown) =>
    typeof value === 'string' && refs.has(value) ? `${where}: props.island names the island made in this change as {${value}}, not ${value}` : undefined;

  // What this change makes and where it moves things, read first: a link is judged by where both its ends are once the
  // whole change is applied, so three linked items moved together to one island are not refused one at a time.
  for (const [i, op] of ops.entries()) {
    if (op.op === 'create') made.set(op.ref ?? `#${i + 1}`, { type: op.type, props: { ...op.props, island: islandKey(op.props?.island) }, title: op.title });
    else if (op.op === 'update' && op.props?.island !== undefined) {
      const before = await map.entity(op.id);
      if (before) moved.set(op.id, { island: islandKey(op.props.island) as string, title: before.title });
    }
  }

  /** The pack an island speaks, or why the id names no island. */
  const packOf = async (key: string): Promise<{ pack?: string; why?: string }> => {
    const ref = made.get(key);
    const found = ref ? { type: ref.type, props: ref.props, archived_at: null } : await map.entity(key);
    if (!found || !reg.isA(found.type, ISLAND)) return { why: `"${key}" is no island` };
    if (found.archived_at) return { why: `the island ${key} is archived` };
    return { pack: String(found.props.pack ?? '') };
  };
  /** The island an item lives on, as this change leaves it; null for an actor, a kernel item or one made before islands. */
  const whereIs = async (key: string): Promise<Where | undefined> => {
    if (moved.has(key)) return moved.get(key);
    const ref = made.get(key);
    if (ref) return { island: (ref.props.island as string) ?? null, title: ref.title };
    const found = await map.entity(key);
    return found && { island: (found.props.island as string | undefined) ?? null, title: found.title };
  };
  const crossing = (where: string, a: Where, b: Where) =>
    a.island && b.island && a.island !== b.island ? `${where}: "${a.title}" lives on the island ${a.island} and "${b.title}" on ${b.island}: no link joins two islands; publish a finding instead` : undefined;
  /** The field an item read across islands must mark true (its type's promised.published), and the item as this change leaves it. */
  const markOf = async (key: string) => {
    const ref = made.get(key);
    const found = ref ?? (await map.entity(key));
    const mark = found && reg.type(found.type)?.capabilities.promised?.published;
    if (!found || !mark) return undefined;
    const set = ops.find((op) => op.op === 'update' && op.id === key && op.props?.[mark] !== undefined) as { props: Record<string, unknown> } | undefined;
    return { mark, published: (set ? set.props[mark] : found.props[mark]) === true, title: found.title };
  };
  /** A link that crosses may only end, across islands, on what its island stands by: an item it marks published. */
  const unpublished = async (where: string, from: string, to: string) => {
    const [a, b] = [await whereIs(from), await whereIs(to)];
    if (!a?.island || !b?.island || a.island === b.island) return undefined;
    const m = await markOf(to);
    if (m && !m.published) return `${where}: "${m.title}" is a working finding of its island: another island reads only what it marks published (props.${m.mark}: true)`;
  };
  /** What is wrong with putting an item of this type on this island. */
  const placing = async (where: string, type: ResolvedType, island: unknown): Promise<string | undefined> => {
    if (typeof island !== 'string' || !island) {
      // Which islands it could go on, so the change is put right in one go.
      const { rows } = await map.db.query<{ id: string; title: string; pack: string }>(`select id, title, props->>'pack' as pack from entity where type = $1 and archived_at is null order by created_at limit 5`, [ISLAND]);
      const there = rows.filter((r) => fits(type, r.pack)).map((r) => `${r.id} (${r.title}, ${r.pack})`);
      return `${where}: a ${type.id} lives on an island here: name it in props.island${there.length ? `, such as ${there.join(', ')}; or make it part of an item on one in this change` : ', on an island made first (type island, props.pack)'}`;
    }
    const { pack, why } = await packOf(island);
    if (why) return `${where}: ${why}`;
    if (!fits(type, pack!)) return `${where}: a ${type.id} is ${type.pack}’s, and the island ${island} speaks ${pack}: an item there is of ${pack}’s types or the shared set`;
  };

  for (const [i, op] of ops.entries()) {
    const where = `op ${i + 1} (${op.op})`;
    const problem = (p?: string) => p && errors.push(p);
    if (op.op === 'create') {
      const type = reg.type(op.type);
      if (!type) continue;
      const props = op.props ?? {};
      if (reg.isA(op.type, ISLAND) && !reg.packs.some((p) => p.id === props.pack)) problem(`${where}: an island speaks a pack active here (props.pack): ${reg.packs.map((p) => p.id).join(', ')}`);
      if (livesOnIsland(type)) problem(bare(where, props.island) ?? (await placing(where, type, islandKey(props.island))));
    } else if (op.op === 'update' && op.props) {
      const before = await map.entity(op.id);
      const type = before && reg.type(before.type);
      if (!before || !type) continue;
      if (reg.isA(type.id, ISLAND) && op.props.pack !== undefined && op.props.pack !== before.props.pack) problem(`${where}: an island’s pack is fixed once it is made`);
      const mark = type.capabilities.promised?.published;
      if (mark && op.props[mark] === false && before.props[mark] === true) {
        // Taken back, it may no longer be read across: its readers on other islands unlink first.
        const { rows } = await map.db.query<{ from_id: string }>(`select from_id from relation where to_id = $1 and valid_to is null and type = any($2::text[]) and id <> all($3::text[]) limit 50`, [op.id, crosses, cut]);
        for (const { from_id } of rows) { const there = await whereIs(from_id); if (there?.island && there.island !== before.props.island) { problem(`${where}: "${before.title}" is read from the island ${there.island} ("${there.title}"): unlink that reading before taking it back`); break; } }
      }
      if (!livesOnIsland(type) || op.props.island === undefined || op.props.island === before.props.island) continue;
      const placed = bare(where, op.props.island) ?? (await placing(where, type, islandKey(op.props.island)));
      if (placed) { problem(placed); continue; }
      const here = moved.get(op.id)!;
      // What it is linked to stays where this change leaves it: a move that would leave a link joining two islands is refused.
      const { rows } = await map.db.query<{ other: string }>(`select case when from_id = $1 then to_id else from_id end as other from relation where (from_id = $1 or to_id = $1) and valid_to is null and id <> all($2::text[]) and type <> all($3::text[])`, [op.id, cut, crosses]);
      for (const { other } of rows) { const there = await whereIs(other); if (there) problem(crossing(where, here, there)); }
    } else if (op.op === 'link' && crosses.includes(op.type)) {
      problem(await unpublished(where, op.from, op.to));
    } else if ((op.op === 'link' && !crosses.includes(op.type)) || op.op === 'merge') {
      const [a, b] = op.op === 'link' ? [op.from, op.to] : [op.keep, op.drop];
      const [x, y] = [await whereIs(a), await whereIs(b)];
      if (x && y) problem(crossing(where, x, y));
    }
  }
  return errors;
}

/** What an island speaks, as a drawing names it in the island's legend: its pack, and every type that lives on an island and link type the pack declares. */
export type IslandPack = { id: string; title: string; types: { id: string; title: string; is?: string[] }[]; links: { id: string; title: string }[] };

/**
 * The vocabulary of the pack `id`, from the registry: none of the kernel's own types or links, nor a starter type, nor an
 * actor, nor what is retired. With `used` (what is on the island in the picture), every other type and link type in use
 * there is named after the pack's own: core's shared task or depends on, a starter used bare (the owner, 7 Nov 2026:
 * every type in use is on the legend).
 */
export function islandPack(registry: Registry, id: string, used?: { types: Iterable<string>; links: Iterable<string> }): IslandPack | undefined {
  const pack = registry.packs.find((p) => p.id === id);
  if (!pack) return undefined;
  const ownTypes = [...registry.types.values()].filter((t) => t.pack === id && typeOnLegend(t));
  const ownLinks = [...registry.relations.values()].filter((r) => r.pack === id && linkOnLegend(r));
  const usedTypes = [...new Set(used?.types ?? [])].map((t) => registry.types.get(t)).filter((t) => t !== undefined && !ownTypes.includes(t) && livesOnIsland(t) && !t.retired && !t.dormant);
  const usedLinks = [...new Set(used?.links ?? [])].map((r) => registry.relations.get(r)).filter((r) => r !== undefined && !ownLinks.includes(r) && linkOnLegend(r));
  const types = [...ownTypes, ...(usedTypes as typeof ownTypes)];
  const links = [...ownLinks, ...(usedLinks as typeof ownLinks)];
  return {
    id, title: pack.title,
    types: types.map((t) => ({ id: t.id, title: t.title, ...(t.lineage.length > 1 && { is: t.lineage.slice(1) }) })),
    links: links.map((r) => ({ id: r.id, title: r.title })),
  };
}
