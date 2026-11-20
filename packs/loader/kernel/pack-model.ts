// The pack model (one tier, feature e_k8nqby7n; lane e_z3ppa6fe): a pack is an item, and each thing it declares is an
// item of one of core's part types, part_of it. packs/pack_model/README.md is the contract. Two ways across:
// `partsOf` takes a pack file to the items install makes, and `manifestsOf` takes the items back to the manifests the
// registry loads (the PackModel of pack-source.ts). Every part keeps its declaration whole in `spec` but its id
// (`declares`), its title (the title) and its description (the note), and records what it shipped as (`shipped`).

import { createHash } from 'node:crypto';
import type { Manifest } from './manifest.ts';

/** An item as the model reads and makes it: its type, head and fields; as the registry reads it, whether it is open and the pack it is part_of. */
export interface ModelItem {
  type: string;
  title: string;
  body: string;
  props: Record<string, unknown>;
  is_open?: boolean;
  /** The name of the pack item it is part_of, where the reader has the link: a part the owner made says its pack so. */
  pack?: string;
}

/** What a part shipped as: its pack, that pack's version, the declaration as the file held it, and its hash. */
export interface Shipped {
  pack: string;
  version: string;
  hash: string;
  value: Record<string, unknown>;
  /** The version of its pack that stopped shipping it: install retires it then, and brings it back if a later one ships it again. */
  dropped?: string;
}

/** A file a part or pack runs, from the repository's root, and the sha256 of its bytes. */
export interface Runs {
  path: string;
  hash: string;
}

/** The pack's own type, and the part types, each core's: the item types the registry is built from. */
export const PACK = 'pack';
/** A part's type is its key's word made one (rules: rule), but links (link_type), screens among the views, and the styles that say their type. */
const one = (key: string) => key.slice(0, -1);
export const PART_KINDS: readonly string[] = ['type', 'link_type', 'rule', 'view', 'screen', 'instruction', 'reflex', 'style', 'lens', 'layout', 'part', 'automation'];
export const MODEL_KINDS: readonly string[] = [PACK, ...PART_KINDS];

/** The keys of a pack file that make parts; every other key stays on the pack's item, in its manifest. */
const PART_KEYS = ['types', 'links', 'rules', 'views', 'styles', 'layouts', 'parts'] as const;
type PartKey = (typeof PART_KEYS)[number];
/** The kinds a styles entry may name by its type that are parts of their own; any other is a style. */
const STYLE_KINDS = ['instruction', 'lens', 'reflex'];
/** A part's id within its pack for an entry that adds fields to another pack's type. */
const OF = 'of:';

/** JSON with its keys sorted at every depth and no whitespace: what a hash is taken of. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** The hash of a file's bytes or a text: the hex sha256, as the registry keeps a pack's. */
export const hashFile = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** The hash of a declaration or a manifest: that of its canonical JSON. */
export const hashOf = (v: unknown) => hashFile(canonical(v));

type Entry = Record<string, unknown>;
const obj = (v: unknown): Entry | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Entry) : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The part type an entry of a key makes. */
function kindOf(key: PartKey, e: Entry): string {
  if (key === 'links') return 'link_type';
  if (key === 'views' && e.form === 'screen') return 'screen';
  if (key === 'styles') return STYLE_KINDS.includes(str(e.type) ?? '') ? String(e.type) : 'style';
  return one(key);
}
/** The key a part type goes back to. */
const KEY_OF: Record<string, PartKey> = { ...Object.fromEntries(PART_KEYS.map((k) => [one(k), k])), link_type: 'links', screen: 'views', ...Object.fromEntries([...STYLE_KINDS, 'style'].map((k) => [k, 'styles'])) };

/** The id an entry declares: its id, or of:<type> for fields it adds to another pack's type. */
const declaresOf = (e: Entry) => (e.of !== undefined && e.id === undefined ? `${OF}${String(e.of)}` : String(e.id ?? ''));
/** Which key of an entry holds its note: body for an instruction's words, description for the rest. */
const noteKey = (e: Entry) => (e.body !== undefined ? 'body' : 'description');

/** What a pack file needs to become items: where its folder is from the repository's root, and the hashes of its files by their path within it. */
export interface FileFacts {
  folder?: string;
  files?: Record<string, string>;
}

/** The items a pack file makes: the pack's own, and one for each thing it declares, in the file's order. */
export function partsOf(m: Manifest, facts: FileFacts = {}): { pack: ModelItem; parts: ModelItem[] } {
  const file = m as unknown as Entry;
  const folder = facts.folder ?? `packs/${m.id}`;
  const runsOf = (paths: string[]): Runs[] | undefined => {
    const out = paths.filter((p) => facts.files?.[p]).map((p) => ({ path: `${folder}/${p}`, hash: facts.files![p] }));
    return out.length ? out : undefined;
  };
  const claimed = new Set<string>();
  const parts: ModelItem[] = [];
  for (const key of PART_KEYS) {
    for (const raw of (file[key] as unknown[] | undefined) ?? []) {
      const e = obj(raw);
      if (!e) continue;
      const declares = declaresOf(e);
      const note = noteKey(e);
      const { id: _id, title, [note]: body, ...spec } = e;
      const modules = Object.values(obj(e.modules) ?? {}).map(String);
      modules.forEach((p) => claimed.add(p));
      const runs = runsOf(modules);
      parts.push({
        type: kindOf(key, e),
        title: str(title) ?? (e.of !== undefined ? `Fields on ${String(e.of)}` : declares),
        body: str(body) ?? '',
        props: { declares, spec, shipped: { pack: m.id, version: m.version, hash: hashOf(e), value: e } satisfies Shipped, ...(runs && { runs }) },
      });
    }
  }
  const manifest = Object.fromEntries(Object.entries(file).filter(([k]) => !(PART_KEYS as readonly string[]).includes(k) && !['title', 'description'].includes(k)));
  const runs = runsOf(Object.keys(facts.files ?? {}).filter((p) => !claimed.has(p)));
  return {
    pack: { type: PACK, title: m.title, body: m.description ?? '', props: { name: m.id, version: m.version, manifest, shipped: { pack: m.id, version: m.version, hash: hashOf(m), value: file } satisfies Shipped, ...(runs && { runs }) } },
    parts,
  };
}

/** A part's declaration again, from its item: its spec, with its id, and its title and note where its file had them (or the owner gave them). */
export function entryOf(item: ModelItem): Entry {
  const declares = String(item.props.declares ?? '');
  const spec = obj(item.props.spec) ?? {};
  const was = obj(item.props.shipped)?.value as Entry | undefined;
  const fresh = !was;
  const isOf = declares.startsWith(OF);
  const note = was ? noteKey(was) : item.type === 'instruction' || item.type === 'reflex' ? 'body' : 'description';
  const titled = was ? 'title' in was : item.title !== declares;
  return {
    ...(isOf ? {} : { id: declares }),
    ...(titled && !isOf && { title: item.title }),
    ...((was ? note in was : fresh && item.body) && { [note]: item.body }),
    ...spec,
  };
}

/** Which pack a part is of: the pack item it is part_of, else the pack it shipped in. One with neither is the map's own. */
const packOfPart = (item: ModelItem) => item.pack ?? str(obj(item.props.shipped)?.pack);

/**
 * The manifests the map's items make, by pack id, each with its hash: a pack's item with what it shipped as (a pack
 * kept as an item with no file is read where it was), and its parts in their file's order, the owner's after them.
 */
export function manifestsOf(items: readonly ModelItem[]): Map<string, { manifest: Manifest; hash: string; text: string }> {
  const out = new Map<string, { manifest: Manifest; hash: string; text: string }>();
  const byPack = new Map<string, ModelItem[]>();
  for (const i of items) if (i.type !== PACK && i.is_open !== false) { const p = packOfPart(i); if (p) byPack.set(p, [...(byPack.get(p) ?? []), i]); }
  for (const pack of items.filter((i) => i.type === PACK && i.is_open !== false && obj(i.props.shipped))) {
    const id = String(pack.props.name ?? '');
    const shipped = obj(pack.props.shipped)!.value as Entry | undefined;
    const manifest: Entry = { ...(obj(pack.props.manifest) ?? {}), id, version: String(pack.props.version ?? '0.1.0'), title: pack.title, ...(pack.body && { description: pack.body }) };
    for (const key of PART_KEYS) if (Array.isArray(shipped?.[key])) manifest[key] = []; // a key the file had, even empty
    // In the file's order, the owner's own after them by their ids.
    const place = (item: ModelItem) => {
      const at = ((shipped?.[KEY_OF[item.type]] as Entry[] | undefined) ?? []).findIndex((e) => obj(e) && declaresOf(e) === item.props.declares);
      return at < 0 ? Infinity : at;
    };
    const parts = (byPack.get(id) ?? []).sort((a, b) => place(a) - place(b) || String(a.props.declares).localeCompare(String(b.props.declares)));
    for (const item of parts) {
      const key = KEY_OF[item.type];
      if (!key) continue;
      manifest[key] = [...((manifest[key] as Entry[] | undefined) ?? []), entryOf(item)];
    }
    const text = canonical(manifest);
    out.set(id, { manifest: manifest as unknown as Manifest, hash: hashFile(text), text });
  }
  return out;
}

/** The pack model as the registry's seam takes it (pack-source.ts setPackModel): the item types, and the manifests they make. */
export const PACK_MODEL = { kinds: MODEL_KINDS, whole: [PACK, 'type', 'link_type'], manifests: manifestsOf };
