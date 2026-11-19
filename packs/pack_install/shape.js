// What a pack and its parts are as items on the map: the contract packs/pack_model/README.md sets (lane 1 of "One
// tier: packs live on the map"), which the registry reads. This is the only file that knows it: the merge (merge.js)
// sees a pack and its parts as a key, a type, a status and plain fields, and what each field was last shipped as.
//
// The pack is an item of core's `pack` type; every declaration is an item of core's type for its kind, part_of the
// pack's item, `declares` its id in the pack file. Each keeps in `shipped` what it last came from: { pack, version,
// hash, value }, value the declaration as the file held it, so the fields it was shipped with are read again from it.

import { createHash } from 'node:crypto';

export const PACK_TYPE = 'pack';
/** The field that keeps what was last shipped. */
export const SHIPPED = 'shipped';
/** The field that names a part within its pack. */
export const DECLARES = 'declares';
/** The field a change offered to the owner writes, so the rule both_changed holds it: "both". */
export const MERGE_MARK = 'pack_merge';
export const RETIRED = 'retired';

/** What the pack item keeps of its file in `manifest`: every key that makes no part (packs/pack_model/README.md). */
const PACK_KEYS = ['id', 'version', 'requires', 'uses', 'actions', 'handlers', 'reach', 'kernel', 'app', 'shared', 'moved_from'];
/** What the file says of the pack that is no part and no manifest: the item's head. */
const HEAD_KEYS = ['title', 'description'];
/** The keys that make parts, in the order they are made. */
export const PART_KEYS = ['types', 'links', 'rules', 'views', 'styles', 'layouts', 'parts'];

/** sha256: and the hex sha256 of canonical JSON: keys sorted at every depth, no whitespace. */
export function hashOf(value) {
  return `sha256:${createHash('sha256').update(canonical(value === undefined ? null : value)).digest('hex')}`;
}
export const canonical = (v) =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);

const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const str = (v) => (typeof v === 'string' ? v : '');

/** The item type a declaration under this manifest key is kept as. */
function typeOf(kind, decl) {
  if (kind === 'types') return 'type';
  if (kind === 'links') return 'link_type';
  if (kind === 'rules') return 'rule';
  if (kind === 'views') return decl.form === 'screen' ? 'screen' : 'view';
  if (kind === 'styles') return decl.type === 'instruction' ? 'instruction' : decl.type === 'lens' ? 'lens' : 'style';
  if (kind === 'layouts') return 'layout';
  if (kind === 'parts') return 'part';
  throw new Error(`no part is made of ${kind}`);
}

/** The id a declaration is kept under in its pack: its id, or of:<type> for fields added to another's. */
const declaresOf = (kind, decl) => (kind === 'types' && typeof decl.of === 'string' ? `of:${decl.of}` : str(decl.id));

/**
 * A declaration as the item holds it: its head (title, body) and fields, as packs/pack_model/README.md maps each kind.
 * The same function reads what was shipped (shipped.value), so the merge compares like with like.
 */
export function asItem(kind, decl) {
  const type = typeOf(kind, decl), declares = declaresOf(kind, decl);
  const title = (str(decl.title) || declares).slice(0, 60);
  if (type === 'type' || type === 'link_type' || type === 'rule' || type === 'view') {
    return { type, title, body: str(decl.description), fields: { [DECLARES]: declares, spec: omit(decl, ['id', 'title', 'description']) } };
  }
  if (kind === 'styles') {
    const props = decl.props && typeof decl.props === 'object' ? decl.props : {};
    const extra = omit(decl, ['id', 'type', 'title', 'description', 'body', 'props']);
    return { type, title, body: type === 'instruction' ? str(decl.body) : str(decl.description), fields: { [DECLARES]: declares, ...extra, ...props } };
  }
  // screen, layout, part: their own fields; code is the repository's, named by runs.
  return { type, title, body: str(decl.description), fields: { [DECLARES]: declares, ...omit(decl, ['id', 'title', 'description', 'form', 'modules']) } };
}

/** The pack's own item, as the head and fields its file gives it. */
export function packAsItem(value) {
  const manifest = Object.fromEntries(PACK_KEYS.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]));
  return { type: PACK_TYPE, title: (str(value.title) || str(value.id)).slice(0, 60), body: str(value.description), fields: { name: value.id, version: String(value.version ?? '0.1.0'), manifest } };
}

/** What the pack's shipped.value holds: its manifest's keys, and its head beside them, so a title is merged as a field is. */
const packValue = (manifest) => Object.fromEntries([...PACK_KEYS, ...HEAD_KEYS].filter((k) => manifest[k] !== undefined).map((k) => [k, manifest[k]]));

/**
 * What a pack file ships, as the merge reads it: { id, version, hash, pack, parts }, each of pack and parts
 * { key, type, title, body, fields, value }, value what its shipped.value is to be.
 */
export function shipped(manifest) {
  if (!manifest || typeof manifest !== 'object' || typeof manifest.id !== 'string' || !manifest.id) throw new Error('a pack file has an id');
  const id = manifest.id, version = String(manifest.version ?? '0.1.0');
  const value = packValue(manifest);
  const pack = { key: `pack:${id}`, value, ...packAsItem(value) };
  const parts = [], seen = new Set();
  for (const kind of PART_KEYS) {
    for (const decl of Array.isArray(manifest[kind]) ? manifest[kind] : []) {
      if (!decl || typeof decl !== 'object') continue;
      const item = asItem(kind, decl);
      if (!item.fields[DECLARES]) throw new Error(`${id} declares one of its ${kind} with no id`);
      const key = `${item.type}:${item.fields[DECLARES]}`;
      if (seen.has(key)) throw new Error(`${id} declares ${key} twice`);
      seen.add(key);
      parts.push({ key, kind, value: decl, ...item });
    }
  }
  return { id, version, hash: hashOf(manifest), pack, parts };
}

/** The kind a part item's type is declared under, to read its shipped.value back. */
const KIND_OF = { type: 'types', link_type: 'links', rule: 'rules', view: 'views', screen: 'views', instruction: 'styles', lens: 'styles', style: 'styles', layout: 'layouts', part: 'parts' };

/**
 * An item of the map as the merge reads it: its key, type, status, head and fields, and `base`, what it was last
 * shipped as (head and fields, read from shipped.value), when it was shipped.
 */
export function onMap(item) {
  const props = item.props ?? {};
  const stamp = props[SHIPPED] && typeof props[SHIPPED] === 'object' ? props[SHIPPED] : undefined;
  const fields = omit(props, [SHIPPED, MERGE_MARK, 'runs']);
  const isPack = item.type === PACK_TYPE;
  const declares = isPack ? props.name : props[DECLARES];
  const key = typeof declares === 'string' && declares ? (isPack ? `pack:${declares}` : `${item.type}:${declares}`) : undefined;
  let base;
  if (stamp?.value && typeof stamp.value === 'object') base = isPack ? packAsItem(stamp.value) : KIND_OF[item.type] ? asItem(KIND_OF[item.type], stamp.value) : undefined;
  return { id: item.id, key, type: item.type, status: item.status, title: item.title ?? '', body: item.body ?? '', fields, stamp, base, pack: stamp?.pack };
}

/** What an item's shipped becomes for this version. */
export const stampOf = (ship, part) => ({ pack: ship.id, version: ship.version, hash: hashOf(part.value), value: part.value });

/** The status a part is made with, and takes again when a later version ships it once more. */
export const openStatus = (type) => (type === 'layout' || type === 'part' ? 'kept' : 'current');

/** The fields an item is compared by, one value each: its head beside its fields, and a type's spec split by its fields and statuses. */
export function flat(item) {
  const out = { title: item.title, body: item.body };
  for (const [k, v] of Object.entries(item.fields)) {
    if (k === 'spec' && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [sk, sv] of Object.entries(v)) {
        if ((sk === 'fields' || sk === 'statuses') && sv && typeof sv === 'object' && !Array.isArray(sv)) for (const [n, x] of Object.entries(sv)) out[`spec.${sk}.${n}`] = x;
        else out[`spec.${sk}`] = sv;
      }
    } else out[k] = v;
  }
  return out;
}

/** The ops' values for some flat fields written over an item: spec put back together over what it holds now. */
export function unflat(now, values) {
  const out = {};
  let spec;
  for (const [k, v] of Object.entries(values)) {
    if (!k.startsWith('spec.')) { out[k] = v; continue; }
    spec ??= structuredClone(now.fields.spec && typeof now.fields.spec === 'object' ? now.fields.spec : {});
    const [sk, n] = splitSpec(k);
    if (n === undefined) v === null ? delete spec[sk] : (spec[sk] = v);
    else {
      spec[sk] = spec[sk] && typeof spec[sk] === 'object' ? spec[sk] : {};
      v === null ? delete spec[sk][n] : (spec[sk][n] = v);
    }
  }
  if (spec) out.spec = spec;
  return out;
}
/** spec.fields.serves → [fields, serves]; spec.extends → [extends]. */
function splitSpec(k) {
  const rest = k.slice(5);
  const m = /^(fields|statuses)\.(.+)$/s.exec(rest);
  return m ? [m[1], m[2]] : [rest];
}

/** The op that makes an item of a shipped part (ref names it for the links in the same change). */
export const createOp = (ship, part, ref, extra = {}) => ({
  op: 'create', ref, type: part.type, title: part.title, ...(part.body && { body: part.body }),
  ...(part.type !== PACK_TYPE && { status: openStatus(part.type) }),
  props: { ...part.fields, [SHIPPED]: stampOf(ship, part), ...extra },
});

/** The op that writes some values on an item: title and body as the head's, the rest as fields. */
export function updateOp(id, values, extra = {}) {
  const { title, body, ...fields } = values;
  const props = { ...fields, ...extra };
  return { op: 'update', id, ...(title !== undefined && { title: title ?? '' }), ...(body !== undefined && { body: body ?? '' }), ...(Object.keys(props).length && { props }) };
}
