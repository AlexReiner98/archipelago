// Each island styled by the packs active on it (decision e_gqmavsb7, the owner, 17 Nov 2026: style per island; and
// e_gg25e3kf: a pack turned off on an island takes its look with it). An island's layer is what the style presets on
// its pack's types say (type_shapes, phase_marks, a glyph...), merged in the order the packs load, each under the
// owner's version of it (a style kept on the map with the preset's id; retired, it is not used), then the styles a
// person keeps on the map on those types, nearest last. A preset counts only
// while its own pack and the island's pack are active on that island (packs/loader/kernel/island-pin.ts), so turning a
// pack off there drops what it drew. Presets on nothing are the view's, never an island's. Nothing is written: read
// for the islands an answer holds.

import { islandRegistry } from './island-pin.ts';
import type { Registry } from './packs.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';

type Props = Record<string, unknown>;
interface Preset { id: string; pack: string; on: string[]; props: Props }

const named = (v: unknown): v is Props => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** A nearer layer over one before it, a field that names things (type_shapes, phase_marks) merged name by name. */
const over = (base: Props, top: Props): Props => {
  const out = { ...base };
  for (const [k, v] of Object.entries(top)) if (v != null && k !== 'preset' && k !== 'on') out[k] = named(v) && named(out[k]) ? { ...(out[k] as Props), ...v } : v;
  return out;
};

/** The style presets the packs ship on types, each with its pack, in load order. */
const presetsOn = (reg: Registry): Preset[] =>
  reg.packs.flatMap((p) => (p.styles ?? []).filter((s) => (s.type ?? 'style') === 'style' && Array.isArray(s.on) && s.on.length).map((s) => ({ id: s.id, pack: p.id, on: s.on as string[], props: s.props ?? {} })));

/** Whether a preset is on a type of `pack` as `run` has it: one of its types, or a type one of them is a flavour of. */
const onPack = (run: Registry, pack: string, on: string[]) => [...run.types.values()].some((t) => t.pack === pack && on.some((o) => run.isA(t.id, o)));

/** What looks on types are drawn from: the presets the packs ship, the owner's versions of them, the styles a person keeps on types. */
export interface Sources { presets: Preset[]; mine: Map<string, { is_open: boolean; props: Props }>; own: { props: Props }[] }

/** Read once for an answer: the presets on types, the owner's versions of them and the styles kept on types. */
export async function styleSources(map: Archipelago): Promise<Sources> {
  const presets = presetsOn(map.registry);
  // The owner's versions of these presets: open, over the preset; retired, the preset is not used.
  const { rows } = await map.db.query<{ preset: string; is_open: boolean; props: Props }>(
    `select props->>'preset' as preset, is_open, props from entity where type = any($1::text[]) and archived_at is null and props->>'preset' = any($2::text[]) order by updated_at -- index entity_type`,
    [map.registry.family('style'), presets.map((p) => p.id)],
  );
  const mine = new Map(rows.map((r) => [r.preset, r]));
  // The styles a person keeps on types, no preset's version: open ones, the last changed nearest.
  const own = (await map.db.query<{ props: Props }>(
    `select props from entity where type = any($1::text[]) and archived_at is null and is_open and props->'on' is not null and props->>'preset' is null order by updated_at -- index entity_type`,
    [map.registry.family('style')],
  )).rows.filter((r) => Array.isArray(r.props.on) && r.props.on.length);
  return { presets, mine, own };
}

/** What the looks on a pack's types say, as `run` (an island's registry, or the map's) has its packs: none from a pack not active there. */
export function packLayer(run: Registry, pack: string, { presets, mine, own }: Sources): Props {
  let layer: Props = {};
  if (run.states.get(pack)?.state !== 'active') return layer;
  for (const p of presets) {
    const v = mine.get(p.id);
    if ((v && !v.is_open) || run.states.get(p.pack)?.state !== 'active') continue;
    const on = v && Array.isArray(v.props.on) && v.props.on.length ? (v.props.on as string[]) : p.on;
    if (onPack(run, pack, on)) layer = over(layer, v ? over(p.props, v.props) : p.props);
  }
  for (const r of own) if (onPack(run, pack, r.props.on as string[])) layer = over(layer, r.props);
  return layer;
}

/**
 * The layer each island is styled by, by island id: for those with a pack, the looks on its pack's types, less what a
 * pack off there drew. An island with none has none.
 */
export async function islandStyles(map: Archipelago, islands: { id: string; pack: string | null }[], given?: Sources): Promise<Map<string, Props>> {
  const out = new Map<string, Props>();
  const isles = islands.filter((i) => i.pack);
  if (!isles.length) return out;
  const sources = given ?? (await styleSources(map));
  for (const isle of isles) {
    const layer = packLayer(await islandRegistry(map, isle.id), isle.pack!, sources);
    if (Object.keys(layer).length) out.set(isle.id, layer);
  }
  return out;
}
