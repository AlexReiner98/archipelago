// Packs authored on the map. A pack is a folder on the server or an item of core's `pack` type: its name the pack's
// id, its title and note the pack's, its manifest what it declares. One made on the map is data alone: the keys of a
// pack on an island map (types, links, rules, views drawn by the kernel, instructions and lenses), so a person or their
// agent on a hosted map can author a way of working without the server running anything of theirs. A rule only
// tightens, a view is drawn by the kernel, and what runs code (actions, handlers, layouts, reach) stays a server's
// pack's. The registry lays these beside the folder packs (src/packs.ts), off until the owner adds one, and judges
// them as it judges any pack; a change that makes or changes one is checked here first (src/type-items.ts).

import { createHash } from 'node:crypto';
import { ISLAND_KEYS } from './islands.ts';
import { readManifest, type Manifest } from './manifest.ts';
import type { TypeItem } from './type-overlay.ts';

export const PACK_ITEM = 'pack';

/** What it is, which the item says: its id (name), version, title and note. */
const SAID = ['id', 'version', 'title', 'description'];
/** The keys a pack made on the map may hold in its manifest: a pack's on an island map, but what the item says. */
const HELD = ISLAND_KEYS.filter((k) => !SAID.includes(k));
/** What a rule in one may not say: a stream kept and its keeping (retention), a setting that lifts it, the server's word. */
const NOT_IN_RULES = ['stream', 'keep', 'lifted', 'server'];
/** The views it may hold: those the kernel draws. */
const DRAWN = ['tree', 'screen', 'attention'];
/** The presets it may hold in styles: what agents are told and views. How things look is kept on the map as styles. */
const PRESETS = ['instruction', 'lens'];
const NAME = /^[a-z][a-z0-9_]*$/;

/** A pack made on the map, as the registry takes it: the item it is kept in, its manifest, and that manifest's text and hash. */
export interface MadePack {
  item: string;
  manifest: Manifest;
  text: string;
  hash: string;
}

type Entry = Record<string, unknown>;
const all = (v: unknown): Entry[] => (Array.isArray(v) ? (v as Entry[]) : []);
/** A pack item as far as it is read here. */
type Said = Pick<TypeItem, 'title' | 'props'> & { body?: string };
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Why a pack item is not a pack that may be taken, as sentences; none when it may. taken: the ids no pack made here may have. */
export function madeProblems(item: Said, taken: Set<string>): string[] {
  const name = text(item.props.name);
  if (!name) return ['a pack needs its id in props.name'];
  const problems: string[] = [];
  if (!NAME.test(name)) problems.push(`its name "${name}" is lower case letters, digits and _, starting with a letter`);
  else if (taken.has(name)) problems.push(`"${name}" is a pack this server has already: choose another name`);
  if (!text(item.title)) problems.push('it needs a title');
  const m = item.props.manifest ?? {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return [...problems, 'its manifest is an object, as a pack.json holds it'];
  const manifest = m as Entry;
  const other = Object.keys(manifest).filter((k) => !HELD.includes(k));
  if (other.length) problems.push(`its manifest holds ${other.join(', ')}: a pack made on the map holds ${HELD.join(', ')} alone (what it is comes from the item; code and reach are a server's packs')`);
  const unnamed = [...all(manifest.types).filter((t) => !('of' in t)), ...all(manifest.links)].map((d) => String(d.id ?? '')).filter((id) => !id.startsWith(`${name}.`));
  if (unnamed.length) problems.push(`what it declares is named ${name}.<what>: ${unnamed.map((id) => id || 'one with no id').join(', ')}`);
  const rules = all(manifest.rules).filter((r) => NOT_IN_RULES.some((k) => k in r)).map((r) => String(r.id ?? 'a rule'));
  if (rules.length) problems.push(`its rules ${rules.join(', ')} say ${NOT_IN_RULES.join(', ')}: a rule in a pack made on the map only holds, refuses, requires or asks`);
  const views = all(manifest.views).filter((v) => !DRAWN.includes(String(v.form))).map((v) => String(v.id ?? 'a view'));
  if (views.length) problems.push(`its views ${views.join(', ')} are not drawn by the kernel: a view here is a tree, a screen or a reason for attention (form), and a view of a query is a lens in styles`);
  const looks = all(manifest.styles).filter((s) => !PRESETS.includes(String(s.type ?? 'style'))).map((s) => String(s.id ?? 'a style'));
  if (looks.length) problems.push(`its styles ${looks.join(', ')} are looks: here styles holds instructions and lenses, and a look is a style kept on the map`);
  if (!problems.length) {
    try {
      readManifest(manifestText(item, name), `the pack item ${name}`);
    } catch (err) {
      problems.push((err as Error).message);
    }
  }
  return problems;
}

/** The manifest a pack item stands for, as text: what the item says it is, then what it declares. */
function manifestText(item: Said, name: string): string {
  const body = text(item.body);
  const manifest = { id: name, version: text(item.props.version) ?? '0.1.0', title: item.title.trim(), ...(body && { description: body }), requires: ['core'], ...(item.props.manifest as Entry) };
  return JSON.stringify(manifest, null, 2);
}

/** Each open pack item that is a pack, and why each other is not, by item. taken: the ids no pack made here may have. */
export function madePacks(items: TypeItem[], taken: Set<string>): { packs: MadePack[]; wrong: Map<string, string> } {
  const packs: MadePack[] = [];
  const wrong = new Map<string, string>();
  const seen = new Set(taken);
  for (const item of items.filter((i) => i.type === PACK_ITEM && i.is_open)) {
    const problems = madeProblems(item, seen);
    if (problems.length) {
      wrong.set(item.id, problems.join('; '));
      continue;
    }
    const name = text(item.props.name)!;
    seen.add(name);
    const text_ = manifestText(item, name);
    packs.push({ item: item.id, manifest: JSON.parse(text_) as Manifest, text: text_, hash: createHash('sha256').update(text_).digest('hex') });
  }
  return { packs, wrong };
}
