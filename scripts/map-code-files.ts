// What `map-code` (scripts/map-code.ts) lays an item's code out as: a folder in a pack folder's shape, so code kept on
// the map is read and edited with the repo's own tools, and moving it into a pack later is a copy (decision e_pjb56hte,
// the owner, 14 Nov 2026). Each code field of the item's type (a field its type marks `code: true`) becomes files:
//
// - a field of text named `code` is index.js, the module a drawing is entered at; another field of text is
//   <field>.css (a field marked css) or <field>.js; a field of text that may be files (marked `files`: a layout's code)
//   and holds files by path is those files, each at its path, and a file new in the folder joins it;
// - a field of modules by name (layout.modules, part.code) or of files by path (a pack version's code) is those files,
//   each at its name, as a pack's folder holds them.
//
// The data its code is run with comes along (task e_swa43ssr): each other field of json its type declares, not kept by
// the system (a layout's settings and writes), is <field>.json, written with its keys in order so the text is the same
// each time; a field of json is read back by its value, so a file only reformatted has not changed.
//
// Each file is kept by the SHA-256 of its text and the whole by codeHash, as the log keeps a pack's code
// (packs/loader/kernel/pack-code.ts), so the hashes a pull records are the ones code kept as files by hash will have.
// Input in, files out: nothing here reads the network or the disk.

import { codeHash, codePath } from '../packs/loader/kernel/pack-code.ts';
import { createHash } from 'node:crypto';

/** A code field as the schema declares it. */
export interface CodeField {
  name: string;
  /** text: one file; files: modules by name, or files by path; json: the data the code runs with, one file. */
  kind: 'text' | 'files' | 'json';
  css?: boolean;
  /** A field of text that may hold files by path instead, entered at index.js (a layout's code). */
  files?: boolean;
}

/** What a pull records beside the files: where they came from, and each file's hash when pulled. */
export interface Pulled {
  url: string;
  item: string;
  type: string;
  title: string;
  /** The item's updated_at when pulled: shown, never trusted; the hashes decide whether the map moved. */
  updated_at?: string;
  /** Each code field, with the paths it was laid out as and each one's hash. */
  fields: Record<string, { kind: CodeField['kind']; files: Record<string, string>; split?: true }>;
  /** codeHash of every file of code (the json fields' files left out). */
  code: string;
}

/** Files in a pulled folder that are its tools, never code sent to the map. */
export const TOOLING = new Set(['jsconfig.json', 'draw.d.ts', '.map-code.json']);

export const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** The code fields of a type, from the schema's fields: those marked code, text or json. */
export function codeFields(fields: Record<string, { type?: string; code?: boolean; css?: boolean; files?: boolean }>): CodeField[] {
  return Object.entries(fields)
    .filter(([, f]) => f.code === true)
    .map(([name, f]) => ({ name, kind: f.type === 'json' ? ('files' as const) : ('text' as const), ...(f.css && { css: true }), ...(f.type !== 'json' && f.files && { files: true }) }));
}

/**
 * The fields a folder holds: the code fields, then the type's other fields of json the system does not keep, which
 * are what the code is run with (a layout's settings). Asked of the schema, never of a type by name.
 */
export function folderFields(fields: Record<string, { type?: string; code?: boolean; css?: boolean; files?: boolean; system?: boolean }>): CodeField[] {
  const code = codeFields(fields);
  if (!code.length) return code;
  const data = Object.entries(fields).filter(([, f]) => f.type === 'json' && f.code !== true && f.system !== true);
  return [...code, ...data.map(([name]) => ({ name, kind: 'json' as const }))];
}

/** The file a field of text is laid out as. */
export const textPath = (f: CodeField) => (f.name === 'code' ? 'index.js' : `${f.name}.${f.css ? 'css' : 'js'}`);

/** The file a field of json is laid out as. */
export const jsonPath = (name: string) => `${name}.json`;

/** A value in order: each object's keys sorted, arrays as they are. */
const ordered = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordered((v as Record<string, unknown>)[k])])) : v;

/** A json field's value as its file holds it: pretty, keys in order, a newline at the end. */
export const jsonText = (v: unknown) => JSON.stringify(ordered(v), null, 2) + '\n';

/** A json field's file read back: its value, and the text it is kept as. */
function jsonOf(path: string, text: string): { value: unknown; text: string } {
  let value: unknown;
  try { value = JSON.parse(text); } catch (err) { throw new Error(`${path} is not JSON: ${(err as Error).message}`); }
  return { value, text: jsonText(value) };
}

/**
 * An item's code fields as files by path, and which field each path belongs to. A field left empty lays out nothing.
 * Throws when two fields would write the same path, or a module's name is not a plain relative path.
 */
export function toFiles(fields: CodeField[], props: Record<string, unknown>): { files: Record<string, string>; owner: Record<string, string> } {
  const files: Record<string, string> = {}, owner: Record<string, string> = {};
  const put = (path: string, text: string, field: string) => {
    if (TOOLING.has(path) || !codePath(path)) throw new Error(`${field}: "${path}" cannot be a file in the folder (a plain relative path ending .js, .css, .json...)`);
    if (owner[path]) throw new Error(`${field} and ${owner[path]} both lay out ${path}`);
    files[path] = text;
    owner[path] = field;
  };
  for (const f of fields) {
    const v = props[f.name];
    if (v === undefined || v === null || v === '') continue;
    if (f.kind === 'text' && f.files && typeof v === 'object' && !Array.isArray(v)) {
      for (const [path, text] of Object.entries(v as Record<string, unknown>)) if (typeof text === 'string') put(path, text, f.name);
    } else if (f.kind === 'text') {
      if (typeof v !== 'string') throw new Error(`${f.name} is not text`);
      put(textPath(f), v, f.name);
    } else if (f.kind === 'json') {
      put(jsonPath(f.name), jsonText(v), f.name);
    } else {
      if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${f.name} is not files by name`);
      for (const [path, text] of Object.entries(v as Record<string, unknown>)) if (typeof text === 'string') put(path, text, f.name);
    }
  }
  return { files, owner };
}

/** What a pull records for files laid out from these fields. */
export function record(base: Omit<Pulled, 'fields' | 'code'>, fields: CodeField[], laid: ReturnType<typeof toFiles>): Pulled {
  const out: Pulled['fields'] = {};
  for (const f of fields) out[f.name] = { kind: f.kind, files: {}, ...(f.files && { split: true as const }) };
  for (const [path, text] of Object.entries(laid.files)) out[laid.owner[path]].files[path] = sha(text);
  const json = new Set(fields.filter((f) => f.kind === 'json').map((f) => f.name));
  const code = Object.entries(laid.files).filter(([p]) => !json.has(laid.owner[p]));
  return { ...base, fields: out, code: codeHash(Object.fromEntries(code.map(([p, t]) => [p, sha(t)]))) };
}

/**
 * The field values a folder's files make, against what was pulled. A file the pull laid out goes back to its field; a
 * new file goes to the one field of files the item has (refused when it has none, or more than one); a file gone is
 * gone from its field (a field of text emptied). Answers only the fields that changed, each whole as change sends it.
 */
export function fromFiles(pulled: Pulled, folder: Record<string, string>): { props: Record<string, unknown>; changed: string[] } {
  const owner = new Map<string, string>();
  for (const [name, f] of Object.entries(pulled.fields)) {
    for (const p of Object.keys(f.files)) owner.set(p, name);
    // A json field left empty when pulled has no file yet: its file, made here, is still its own.
    if (f.kind === 'json') owner.set(jsonPath(name), name);
  }
  // A new file joins the field that may be files and holds index.js (a layout's code split), else the one field of files.
  const entry = Object.entries(pulled.fields).find(([, f]) => f.split && 'index.js' in f.files)?.[0];
  const filesFields = entry ? [entry] : Object.entries(pulled.fields).filter(([, f]) => f.kind === 'files').map(([n]) => n);
  const values: Record<string, Record<string, string>> = {};
  for (const name of Object.keys(pulled.fields)) values[name] = {};
  for (const [path, text] of Object.entries(folder)) {
    if (TOOLING.has(path)) continue;
    let field = owner.get(path);
    if (!field) {
      if (filesFields.length !== 1) throw new Error(`${path} is new, and ${pulled.type} has ${filesFields.length ? 'more than one field' : 'no field'} of files to put it in`);
      field = filesFields[0];
    }
    values[field][path] = pulled.fields[field].kind === 'json' ? jsonOf(path, text).text : text;
  }
  const props: Record<string, unknown> = {}, changed: string[] = [];
  for (const [name, f] of Object.entries(pulled.fields)) {
    const now = values[name];
    const same = Object.keys(now).length === Object.keys(f.files).length && Object.entries(now).every(([p, t]) => f.files[p] === sha(t));
    if (same) continue;
    changed.push(...[...new Set([...Object.keys(now), ...Object.keys(f.files)])].filter((p) => f.files[p] !== (now[p] === undefined ? undefined : sha(now[p]))));
    // A field that may be files is one text while index.js is all it has, and files by path once it has more.
    const paths = Object.keys(now);
    props[name] = f.split && (paths.length > 1 || (paths.length === 1 && paths[0] !== 'index.js')) ? now : f.kind === 'text' ? (Object.values(now)[0] ?? '') : f.kind === 'json' ? (now[jsonPath(name)] === undefined ? null : JSON.parse(now[jsonPath(name)])) : now;
  }
  return { props, changed: changed.sort() };
}

/** The fields of the type a folder watches: those it was pulled with (a field declared since waits for a pull). */
export const watched = (pulled: Pulled, fields: CodeField[]) => fields.filter((f) => pulled.fields[f.name]);

/** Which of the pulled fields the map holds differently now: the map moved under the folder. */
export function moved(pulled: Pulled, fields: CodeField[], props: Record<string, unknown>): string[] {
  const kept = watched(pulled, fields);
  const now = record(pulled, kept, toFiles(kept, props));
  return Object.keys({ ...pulled.fields, ...now.fields }).filter((name) => {
    const a = pulled.fields[name]?.files ?? {}, b = now.fields[name]?.files ?? {};
    return Object.keys(a).length !== Object.keys(b).length || Object.entries(a).some(([p, h]) => b[p] !== h);
  });
}
