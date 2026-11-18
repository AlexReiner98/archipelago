// A pack's parts, and the parts an island turned off (feature e_4r82mvf3; decisions e_8cfbg5qm, e_vqf2abmw, the
// owner, 18 Nov 2026). Every declaration of a pack is a part, by its id: a type, a link type, a rule, a view (a read, a
// tree, a screen, a reason for attention), an instruction, a lens, a style. What a part needs is read off what it
// names: a type its parent, a link type its ends and its parent, a rule the types it judges, a view or a style the types
// it is on. An island names the parts it has off in its field parts_off; its registry is the map's with those taken out
// of their packs before they load (packs/loader/kernel/packs.ts, island-pin.ts), and with them every part that needs
// one, transitively and across packs: those wait, saying what they lack. A pack that requires a name a part off gave
// (type:build.lane) waits by the order's own reading (packs/loader/kernel/packorder.ts). Only the island turns parts
// off: a pack never drops another's. The kernel's own pack is never touched. Pure: manifests in, manifests out.

import type { Manifest } from './manifest.ts';
import { KERNEL_PACKS } from './packorder.ts';

/** The field of an island that lists the parts it has off, by id. */
export const PARTS_OFF = 'parts_off';

/** The key of a manifest each kind of part is declared under, so it can be taken out. */
const KEYS = { type: 'types', link: 'links', rule: 'rules', view: 'views', instruction: 'styles', lens: 'styles', style: 'styles' } as const;
/** What kind of declaration a part is. */
export type PartKind = keyof typeof KEYS;
/** A rule's kind, read off the keys: the word is also a pack's type, which the kernel never names (test/structure.test.ts). */
const RULE = Object.keys(KEYS)[2] as PartKind;

/** A part of a pack: its id, its kind, and the type and link type ids it names. */
export interface PackPart { id: string; kind: PartKind; needs: string[] }

/** A part's state on an island where it is not on: off (the island turned it off) or waiting (a part it needs is not on), with the names it lacks. */
export interface PartState { pack: string; kind: PartKind; state: 'off' | 'waiting'; lacks: string[] }

const names = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter((s): s is string => typeof s === 'string' && s !== '*' && !s.startsWith('has:'));

/** The parts a pack declares, each with what it names. Fields added to another pack's type (`of`) are not a part: an island pack adds none. */
export function packParts(m: Manifest): PackPart[] {
  const out: PackPart[] = [];
  for (const t of m.types ?? []) if (!('of' in t)) out.push({ id: t.id, kind: 'type', needs: names(t.extends) });
  for (const r of m.links ?? []) out.push({ id: r.id, kind: 'link', needs: [...new Set([...names(r.from), ...names(r.to), ...names(r.extends)])] });
  for (const r of m.rules ?? []) if (r.id) out.push({ id: r.id, kind: RULE, needs: [...new Set([...names(r.when?.type), ...names((r as { type?: unknown }).type)])] });
  for (const v of m.views ?? []) {
    const w = v as unknown as Record<string, unknown>;
    out.push({ id: v.id, kind: 'view', needs: [...new Set([...names(w.on), ...names(w.of), ...names(w.roots), ...names(w.branches), ...names(w.work)])] });
  }
  for (const s of m.styles ?? []) out.push({ id: s.id, kind: s.type === 'instruction' ? 'instruction' : s.type === 'lens' ? 'lens' : 'style', needs: names(s.on) });
  return out;
}


/**
 * The packs found with the parts an island has off taken out, and every part that needs one (transitively, across
 * packs) taken out too, as waiting. Answers the manifests to load and the state of each part not on, by id. The
 * kernel's pack keeps all of its parts, and a part off that no pack declares is left alone.
 */
export function withoutParts(found: Map<string, Manifest>, off: readonly string[]): { found: Map<string, Manifest>; states: Map<string, PartState> } {
  const states = new Map<string, PartState>();
  if (!off.length) return { found, states };
  const all = [...found.values()].filter((m) => !KERNEL_PACKS.includes(m.id)).flatMap((m) => packParts(m).map((p) => ({ ...p, pack: m.id })));
  for (const p of all) if (off.includes(p.id)) states.set(p.id, { pack: p.pack, kind: p.kind, state: 'off', lacks: [] });
  for (let grew = true; grew;) {
    grew = false;
    for (const p of all) {
      if (states.has(p.id)) continue;
      const lacks = p.needs.filter((n) => states.has(n));
      if (lacks.length) { states.set(p.id, { pack: p.pack, kind: p.kind, state: 'waiting', lacks: lacks.map((n) => `type:${n}`) }); grew = true; }
    }
  }
  if (!states.size) return { found, states };
  const out = new Map(found);
  for (const [id, m] of found) {
    const gone = packParts(m).filter((p) => states.has(p.id));
    if (!gone.length || KERNEL_PACKS.includes(id)) continue;
    const drop = new Set(gone.map((p) => `${KEYS[p.kind]}:${p.id}`));
    const keep = <T extends { id?: string }>(key: string, list: T[] | undefined) => list && list.filter((d) => !d.id || !drop.has(`${key}:${d.id}`));
    out.set(id, { ...m, types: keep('types', m.types as { id?: string }[]) as Manifest['types'], links: keep('links', m.links), rules: keep('rules', m.rules), views: keep('views', m.views), styles: keep('styles', m.styles) });
  }
  return { found: out, states };
}

type ItemLike = { props?: Record<string, unknown> | null; archived_at?: unknown };

/** The parts an island names off, as ids: none for an archived item or one that says none. Whether the item is an island is the caller's (isIslandItem). */
export function partsOffOn(island: ItemLike | undefined): string[] {
  if (!island || island.archived_at) return [];
  const said = island.props?.[PARTS_OFF];
  return Array.isArray(said) ? [...new Set(said.filter((p): p is string => typeof p === 'string'))].sort() : [];
}

/** Why a list of part ids cannot be an island's parts_off, as sentences: not a list of ids, a part of the kernel's own pack, or no part any pack here declares. */
export function partsOffProblems(found: Iterable<Manifest>, set: unknown): string[] {
  if (!Array.isArray(set) || set.some((p) => typeof p !== 'string')) return [`${PARTS_OFF} is a list of part ids, e.g. ["build.overlap"]`];
  const by = new Map([...found].flatMap((m) => packParts(m).map((p) => [p.id, m.id] as const)));
  const problems: string[] = [];
  for (const id of new Set(set as string[])) {
    const pack = by.get(id);
    if (!pack) problems.push(`no pack here declares a part "${id}": a type, link type, rule, view, instruction, lens or style id`);
    else if (KERNEL_PACKS.includes(pack)) problems.push(`"${id}" is the kernel's own (${pack}): it is never turned off`);
  }
  return problems;
}
