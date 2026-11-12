// Packs authored on the map. A pack is a folder on the server or an item of core's `pack` type: its name the pack's
// id, its title and note the pack's, its manifest what it declares. One kept as an item is data alone: the keys of a
// pack on an island map (types, links, rules, views drawn by the kernel, and styles: looks, instructions and lenses),
// so a person or their agent on a hosted map can author a way of working, or a look, without the server running
// anything of theirs. On an island map the island rules judge it as any pack, looks included. A rule only
// tightens, a view is drawn by the kernel, and what runs code (actions, handlers, layouts, reach) stays a server's
// pack's. A version of a server's pack alone may carry code of its own (its field code: files by path over its
// pack's), run only on the islands that run the version (packs/loader/kernel/pack-code.ts), and an agent's word for it always waits
// for the owner (core's rule pack_code). The registry lays these beside the folder packs (packs/loader/kernel/packs.ts), off until the owner adds one, and judges
// them as it judges any pack; a change that makes or changes one is checked here first (packs/loader/kernel/type-items.ts).

import { createHash } from 'node:crypto';
import { ISLAND_KEYS } from './islands.ts';
import { parts, readManifest, type Manifest } from './manifest.ts';
import { KERNEL_PACKS } from './packorder.ts';
import { versionCodeProblems } from './pack-code.ts';
import type { TypeItem } from './type-overlay.ts';

export const PACK_ITEM = 'pack';

/** What it is, which the item says: its id (name), version, title and note. */
const SAID = ['id', 'version', 'title', 'description'];
/** The keys a pack kept as an item may hold in its manifest: a pack's on an island map, but what the item says. */
const HELD = ISLAND_KEYS.filter((k) => !SAID.includes(k));
/** What a rule in one may not say: a stream kept and its keeping (retention), a setting that lifts it, the server's word. */
const NOT_IN_RULES = ['stream', 'keep', 'lifted', 'server'];
/** The views it may hold: those the kernel draws. */
const DRAWN = ['tree', 'screen', 'attention'];
const NAME = /^[a-z][a-z0-9_]*$/;

/** a pack kept as an item, as the registry takes it: the item it is kept in, its manifest, and that manifest's text and hash. */
export interface ItemPack {
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

/** Why a pack item is not a pack that may be taken, as sentences; none when it may. taken: the ids no pack made here may have; declared: the type and link ids the server's packs declare, on or off. */
export function madeProblems(item: Said, taken: Set<string>, declared: Set<string> = new Set()): string[] {
  const name = text(item.props.name);
  if (!name) return ['a pack needs its id in props.name'];
  const problems: string[] = [];
  if (!NAME.test(name)) problems.push(`its name "${name}" is lower case letters, digits and _, starting with a letter`);
  else if (taken.has(name)) problems.push(`"${name}" is a pack this server has already: choose another name`);
  if (!text(item.title)) problems.push('it needs a title');
  const manifest = heldOf(item);
  if (!manifest) return [...problems, 'its manifest is an object, as a pack.json holds it'];
  problems.push(...heldProblems(manifest));
  const unnamed = [...all(manifest.types).filter((t) => !('of' in t)), ...all(manifest.links)].map((d) => String(d.id ?? '')).filter((id) => !id.startsWith(`${name}.`));
  if (unnamed.length) problems.push(`what it declares is named ${name}.<what>: ${unnamed.map((id) => id || 'one with no id').join(', ')}`);
  // A clash with a pack the server has, even one off here, would stop the registry loading once that one is on.
  const clash = [...all(manifest.types), ...all(manifest.links)].map((d) => String(d.id ?? '')).filter((id) => declared.has(id));
  if (clash.length) problems.push(`a pack this server has declares ${clash.join(', ')} already`);
  const misnamedRules = all(manifest.rules).map((r) => String(r.id ?? '')).filter((id) => !id.startsWith(`${name}.`));
  if (misnamedRules.length) problems.push(`its rules are named ${name}.<what>, so none is taken for a kernel rule: ${misnamedRules.map((id) => id || 'one with no id').join(', ')}`);
  if (item.props.code !== undefined && item.props.code !== null) problems.push('a pack kept as an item runs no code: only a version of a server’s pack may carry code (version_of)');
  if (!problems.length) {
    try {
      readManifest(manifestText(item, name), `the pack item ${name}`);
    } catch (err) {
      problems.push((err as Error).message);
    }
  }
  return problems;
}

/** What a pack item's manifest holds, if it is an object. */
const heldOf = (item: Said): Entry | undefined => { const m = item.props.manifest ?? {}; return m && typeof m === 'object' && !Array.isArray(m) ? (m as Entry) : undefined; };

/** What a pack item may not hold, whether a pack or a version of one: a key but the held ones, a rule that keeps or is lifted, a view the kernel does not draw. */
function heldProblems(manifest: Entry): string[] {
  const problems: string[] = [];
  const other = Object.keys(manifest).filter((k) => !HELD.includes(k));
  if (other.length) problems.push(`its manifest holds ${other.join(', ')}: a pack kept as an item holds ${HELD.join(', ')} alone (what it is comes from the item; code and reach are a server's packs')`);
  const rules = all(manifest.rules).filter((r) => NOT_IN_RULES.some((k) => k in r)).map((r) => String(r.id ?? 'a rule'));
  if (rules.length) problems.push(`its rules ${rules.join(', ')} say ${NOT_IN_RULES.join(', ')}: a rule in a pack kept as an item only holds, refuses, requires or asks`);
  const views = all(manifest.views).filter((v) => !DRAWN.includes(String(v.form))).map((v) => String(v.id ?? 'a view'));
  if (views.length) problems.push(`its views ${views.join(', ')} are not drawn by the kernel: a view here is a tree, a screen or a reason for attention (form), and a view of a query is a lens in styles`);
  return problems;
}

/** A version of a pack kept as an item (its field version_of): what an island may run in that pack's place, never a pack of its own. */
export interface PackVersion extends ItemPack {
  of: string;
  /** Its own code, files by path over its pack's (packs/loader/kernel/pack-code.ts): run on its islands alone. */
  code?: Record<string, string>;
}

/** The ids a manifest declares as its own types and link types, sorted. */
const declaredIds = (m: Manifest) => [...parts(m).types, ...parts(m).relations].map((d) => d.id).sort();

/**
 * Why a pack item is not a version of the pack it names; none when it is. A version holds what a pack item may, and
 * over its pack's manifest it takes the place of those keys alone, so a map pack's code stays as it is. It keeps every
 * type and link type its pack declares, by the same ids, and may add its own (named <pack>.<what>): it may change their
 * fields, the rules, the views and the styles (data: instructions, lenses, looks), never rename or leave one out.
 */
export function versionProblems(item: Said, of: string, base: Manifest | undefined, local: string): string[] {
  if (!base || of === local) return [`it is a version of "${of}", which is no pack here`];
  if (KERNEL_PACKS.includes(of)) return [`"${of}" is the kernel's own: it has no version but the server's`];
  const problems: string[] = [];
  const name = text(item.props.name);
  if (name && name !== of) problems.push(`its name is its pack's, ${of}, or none`);
  if (!text(item.title)) problems.push('it needs a title');
  const held = heldOf(item);
  if (!held) return [...problems, 'its manifest is an object, as a pack.json holds it'];
  problems.push(...heldProblems(held));
  if (problems.length) return problems;
  let manifest: Manifest;
  try { manifest = readManifest(versionText(item, base), `the version ${item.title} of ${of}`); } catch (err) { return [(err as Error).message]; }
  const [was, now] = [declaredIds(base), declaredIds(manifest)];
  const gone = was.filter((id) => !now.includes(id)), misnamed = now.filter((id) => !was.includes(id) && !id.startsWith(`${of}.`));
  if (gone.length) problems.push(`a version keeps every type and link type its pack declares, by the same ids, since items may be of them: it leaves out ${gone.join(', ')}`);
  if (misnamed.length) problems.push(`what a version adds is named ${of}.<what>: ${misnamed.join(', ')}`);
  return problems;
}

/** The manifest a version stands for, as text: its pack's, with the keys the version holds in their place. */
function versionText(item: Said, base: Manifest): string {
  return JSON.stringify({ ...base, version: text(item.props.version) ?? `${base.version}+trial`, ...(heldOf(item) ?? {}) }, null, 2);
}

/** The manifest a pack item stands for, as text: what the item says it is, then what it declares. */
function manifestText(item: Said, name: string): string {
  const body = text(item.body);
  const manifest = { id: name, version: text(item.props.version) ?? '0.1.0', title: item.title.trim(), ...(body && { description: body }), requires: ['core'], ...(item.props.manifest as Entry) };
  return JSON.stringify(manifest, null, 2);
}

/** Each open pack item that is a pack, and why each other is not, by item, beside the packs found in the server's folders. */
export function madePacks(items: TypeItem[], found: Map<string, Manifest>, local: string): { packs: ItemPack[]; versions: PackVersion[]; wrong: Map<string, string> } {
  const packs: ItemPack[] = [], versions: PackVersion[] = [];
  const wrong = new Map<string, string>();
  const hash = (t: string) => createHash('sha256').update(t).digest('hex');
  const seen = new Set([...found.keys(), local]);
  const declared = new Set([...found.values()].flatMap((p) => [...parts(p).types, ...parts(p).relations].map((d) => d.id)));
  for (const item of items.filter((i) => i.type === PACK_ITEM && i.is_open && !text(i.props.version_of))) {
    const problems = madeProblems(item, seen, declared);
    if (problems.length) {
      wrong.set(item.id, problems.join('; '));
      continue;
    }
    const name = text(item.props.name)!;
    seen.add(name);
    const text_ = manifestText(item, name);
    packs.push({ item: item.id, manifest: JSON.parse(text_) as Manifest, text: text_, hash: hash(text_) });
  }
  // A version is of a pack the server has or one kept as an item.
  const bases = new Map([...found, ...packs.map((p) => [p.manifest.id, p.manifest] as const)]);
  for (const item of items.filter((i) => i.type === PACK_ITEM && i.is_open && text(i.props.version_of))) {
    const of = text(item.props.version_of)!;
    const problems = [...versionProblems(item, of, bases.get(of), local), ...versionCodeProblems(item.props.code, of, found.has(of))];
    if (problems.length) { wrong.set(item.id, problems.join('; ')); continue; }
    const t = versionText(item, bases.get(of)!);
    const code = item.props.code ? (item.props.code as Record<string, string>) : undefined;
    // Its hash is its manifest's, and its code's with it: a version whose code changed is another version.
    versions.push({ item: item.id, of, manifest: JSON.parse(t) as Manifest, text: t, hash: hash(code ? `${t} ${JSON.stringify(Object.entries(code).sort(([a], [b]) => (a < b ? -1 : 1)))}` : t), ...(code && { code }) });
  }
  return { packs, versions, wrong };
}
