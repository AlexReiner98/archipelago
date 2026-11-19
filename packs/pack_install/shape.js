// What a pack and its parts are as items on the map: the contract packs/pack_model/README.md sets (lane 1 of "One
// tier: packs live on the map"), which the registry reads. This is the only file here that knows it: the merge
// (merge.js) sees a pack and its parts as a key, a type, a status, a head and plain fields, and what each was last
// shipped as.
//
// A pack's code imports nothing of the kernel, so this mirrors partsOf in packs/loader/kernel/pack-model.ts rather
// than calling it: the pack is an item of core's `pack` type; every declaration is an item of core's part type for
// it, part_of the pack's item, `declares` its id, `spec` the declaration but its id, title and note, `shipped`
// { pack, version, hash, value } with value the declaration (for the pack, the whole file) as the file held it.

import { createHash } from 'node:crypto';

export const PACK_TYPE = 'pack';
/** The field that keeps what was last shipped. */
export const SHIPPED = 'shipped';
/** The field that names a part within its pack. */
export const DECLARES = 'declares';
/** The field that names the code a pack or part runs. */
export const RUNS = 'runs';
/** The field a change offered to the owner writes, so the rule both_changed holds it: "both". */
export const MERGE_MARK = 'pack_merge';
export const RETIRED = 'retired';

/** The keys of a pack file that make parts, in the order they are made; every other key stays on the pack's item. */
export const PART_KEYS = ['types', 'links', 'rules', 'views', 'styles', 'layouts', 'parts'];
/** The kinds a styles entry may name by its type that are parts of their own; any other is a style. */
const STYLE_KINDS = ['instruction', 'lens', 'reflex'];
const OF = 'of:';

/** JSON with its keys sorted at every depth and no whitespace: what a hash is taken of. */
export const canonical = (v) =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);
/** The hex sha256 of a value's canonical JSON. */
export const hashOf = (v) => createHash('sha256').update(canonical(v === undefined ? null : v)).digest('hex');

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : undefined);
const str = (v) => (typeof v === 'string' ? v : undefined);

/** The part type an entry under a key makes. */
function kindOf(key, e) {
  if (key === 'links') return 'link_type';
  if (key === 'views' && e.form === 'screen') return 'screen';
  if (key === 'styles') return STYLE_KINDS.includes(str(e.type) ?? '') ? e.type : 'style';
  return key.slice(0, -1);
}
/** The key a part type goes back to. */
const KEY_OF = { type: 'types', link_type: 'links', rule: 'rules', view: 'views', screen: 'views', instruction: 'styles', lens: 'styles', reflex: 'styles', style: 'styles', layout: 'layouts', part: 'parts' };
/** The id an entry declares: its id, or of:<type> for the fields it adds to another pack's type. */
const declaresOf = (e) => (e.of !== undefined && e.id === undefined ? `${OF}${String(e.of)}` : String(e.id ?? ''));
/** Which key of an entry holds its note: body for an instruction's words, description for the rest. */
const noteKey = (e) => (e.body !== undefined ? 'body' : 'description');

/** A declaration as its item holds it: its type, head, and the fields declares and spec. */
export function asItem(key, e) {
  const declares = declaresOf(e), note = noteKey(e);
  const { id: _id, title, [note]: body, ...spec } = e;
  return {
    type: kindOf(key, e),
    title: str(title) ?? (e.of !== undefined ? `Fields on ${String(e.of)}` : declares),
    body: str(body) ?? '',
    fields: { [DECLARES]: declares, spec },
  };
}

/** The pack's own item from its file: its head, name, version, and manifest (every key that makes no part). */
export function packAsItem(file) {
  const manifest = Object.fromEntries(Object.entries(file).filter(([k]) => !PART_KEYS.includes(k) && k !== 'title' && k !== 'description'));
  return { type: PACK_TYPE, title: str(file.title) ?? String(file.id), body: str(file.description) ?? '', fields: { name: file.id, version: file.version, manifest } };
}

/**
 * What a pack file ships, as the merge reads it: { id, version, hash, pack, parts }, each of pack and parts
 * { key, type, title, body, fields, value, runs? }, value what its shipped.value is to be. facts: { folder, files },
 * the pack's folder from the repository's root and its files' hashes by path within it, which give runs.
 */
export function shipped(manifest, facts = {}) {
  if (!obj(manifest) || typeof manifest.id !== 'string' || !manifest.id) throw new Error('a pack file has an id');
  const id = manifest.id, version = manifest.version;
  const folder = facts.folder ?? `packs/${id}`, files = obj(facts.files) ?? {};
  const runsOf = (paths) => { const out = paths.filter((p) => files[p]).map((p) => ({ path: `${folder}/${p}`, hash: files[p] })); return out.length ? out : undefined; };
  const claimed = new Set(), parts = [], seen = new Set();
  for (const key of PART_KEYS) {
    for (const raw of Array.isArray(manifest[key]) ? manifest[key] : []) {
      const e = obj(raw);
      if (!e) continue;
      const item = asItem(key, e);
      if (!item.fields[DECLARES]) throw new Error(`${id} declares one of its ${key} with no id`);
      const partKey = `${item.type}:${item.fields[DECLARES]}`;
      if (seen.has(partKey)) throw new Error(`${id} declares ${partKey} twice`);
      seen.add(partKey);
      const modules = Object.values(obj(e.modules) ?? {}).map(String);
      modules.forEach((p) => claimed.add(p));
      parts.push({ key: partKey, value: e, runs: runsOf(modules), ...item });
    }
  }
  const pack = { key: `pack:${id}`, value: manifest, runs: runsOf(Object.keys(files).filter((p) => !claimed.has(p))), ...packAsItem(manifest) };
  return { id, version, hash: hashOf(manifest), pack, parts };
}

/**
 * An item of the map as the merge reads it: its key, type, status, head and fields, and `base`, what it was last
 * shipped as (head and fields, read again from shipped.value), when it was shipped.
 */
export function onMap(item) {
  const props = item.props ?? {};
  const stamp = obj(props[SHIPPED]);
  const fields = Object.fromEntries(Object.entries(props).filter(([k]) => ![SHIPPED, MERGE_MARK, RUNS].includes(k)));
  const isPack = item.type === PACK_TYPE;
  const declares = isPack ? props.name : props[DECLARES];
  const key = typeof declares === 'string' && declares ? (isPack ? `pack:${declares}` : `${item.type}:${declares}`) : undefined;
  const value = obj(stamp?.value);
  const base = !value ? undefined : isPack ? packAsItem(value) : KEY_OF[item.type] ? asItem(KEY_OF[item.type], value) : undefined;
  return { id: item.id, key, type: item.type, status: item.status, title: item.title ?? '', body: item.body ?? '', fields, stamp, runs: props[RUNS], base, pack: stamp?.pack };
}

/** What an item's shipped becomes for this version. */
export const stampOf = (ship, part) => ({ pack: ship.id, version: ship.version, hash: hashOf(part.value), value: part.value });

/** The status a part is made with, and takes again when a later version ships it once more. */
export const openStatus = (type) => (type === 'layout' || type === 'part' ? 'kept' : 'current');

/** The fields an item is merged by, one value each: title, note, each top-level key of spec, and each of a type's spec.fields. */
export function flat(item) {
  const out = { title: item.title, body: item.body };
  for (const [k, v] of Object.entries(item.fields)) {
    if (k !== 'spec' || !obj(v)) { out[k] = v; continue; }
    for (const [sk, sv] of Object.entries(v)) {
      if (item.type === 'type' && sk === 'fields' && obj(sv)) for (const [n, x] of Object.entries(sv)) out[`spec.fields.${n}`] = x;
      else out[`spec.${sk}`] = sv;
    }
  }
  return out;
}

/** The ops' values for some flat fields written over an item: spec put back together over what it holds now. */
export function unflat(now, values) {
  const out = {};
  let spec;
  for (const [k, v] of Object.entries(values)) {
    if (!k.startsWith('spec.')) { out[k] = v; continue; }
    spec ??= structuredClone(obj(now.fields.spec) ?? {});
    const m = /^spec\.fields\.(.+)$/s.exec(k);
    if (m && now.type === 'type') {
      spec.fields = obj(spec.fields) ?? {};
      v === null ? delete spec.fields[m[1]] : (spec.fields[m[1]] = v);
    } else {
      const sk = k.slice(5);
      v === null ? delete spec[sk] : (spec[sk] = v);
    }
  }
  if (spec) out.spec = spec;
  return out;
}

/** The op that makes an item of a shipped part (ref names it for the links in the same change). */
export const createOp = (ship, part, ref) => ({
  op: 'create', ref, type: part.type, title: part.title, ...(part.body && { body: part.body }),
  ...(part.type !== PACK_TYPE && { status: openStatus(part.type) }),
  props: { ...part.fields, [SHIPPED]: stampOf(ship, part), ...(part.runs && { [RUNS]: part.runs }) },
});

/** The op that writes some values on an item: title and body as the head's, the rest as fields. */
export function updateOp(id, values, extra = {}) {
  const { title, body, ...fields } = values;
  const props = { ...fields, ...extra };
  return { op: 'update', id, ...(title !== undefined && { title: title ?? '' }), ...(body !== undefined && { body: body ?? '' }), ...(Object.keys(props).length && { props }) };
}
