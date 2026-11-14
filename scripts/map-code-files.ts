// What `map-code` (scripts/map-code.ts) lays an item's code out as: a folder in a pack folder's shape, so code kept on
// the map is read and edited with the repo's own tools, and moving it into a pack later is a copy (decision e_pjb56hte,
// the owner, 14 Nov 2026). Each code field of the item's type (a field its type marks `code: true`) becomes files:
//
// - a field of text named `code` is index.js, the module a drawing is entered at; another field of text is
//   <field>.css (a field marked css) or <field>.js;
// - a field of modules by name (layout.modules, part.code) or of files by path (a pack version's code) is those files,
//   each at its name, as a pack's folder holds them.
//
// Each file is kept by the SHA-256 of its text and the whole by codeHash, as the log keeps a pack's code
// (packs/loader/kernel/pack-code.ts), so the hashes a pull records are the ones code kept as files by hash will have.
// Input in, files out: nothing here reads the network or the disk.

import { codeHash, codePath } from '../packs/loader/kernel/pack-code.ts';
import { createHash } from 'node:crypto';

/** A code field as the schema declares it. */
export interface CodeField {
  name: string;
  /** text: one file; files: modules by name, or files by path. */
  kind: 'text' | 'files';
  css?: boolean;
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
  fields: Record<string, { kind: CodeField['kind']; files: Record<string, string> }>;
  /** codeHash of every file. */
  code: string;
}

/** Files in a pulled folder that are its tools, never code sent to the map. */
export const TOOLING = new Set(['jsconfig.json', 'draw.d.ts', '.map-code.json']);

export const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** The code fields of a type, from the schema's fields: those marked code, text or json. */
export function codeFields(fields: Record<string, { type?: string; code?: boolean; css?: boolean }>): CodeField[] {
  return Object.entries(fields)
    .filter(([, f]) => f.code === true)
    .map(([name, f]) => ({ name, kind: f.type === 'json' ? ('files' as const) : ('text' as const), ...(f.css && { css: true }) }));
}

/** The file a field of text is laid out as. */
export const textPath = (f: CodeField) => (f.name === 'code' ? 'index.js' : `${f.name}.${f.css ? 'css' : 'js'}`);

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
    if (f.kind === 'text') {
      if (typeof v !== 'string') throw new Error(`${f.name} is not text`);
      put(textPath(f), v, f.name);
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
  for (const f of fields) out[f.name] = { kind: f.kind, files: {} };
  for (const [path, text] of Object.entries(laid.files)) out[laid.owner[path]].files[path] = sha(text);
  return { ...base, fields: out, code: codeHash(Object.fromEntries(Object.entries(laid.files).map(([p, t]) => [p, sha(t)]))) };
}

/**
 * The field values a folder's files make, against what was pulled. A file the pull laid out goes back to its field; a
 * new file goes to the one field of files the item has (refused when it has none, or more than one); a file gone is
 * gone from its field (a field of text emptied). Answers only the fields that changed, each whole as change sends it.
 */
export function fromFiles(pulled: Pulled, folder: Record<string, string>): { props: Record<string, unknown>; changed: string[] } {
  const owner = new Map<string, string>();
  for (const [name, f] of Object.entries(pulled.fields)) for (const p of Object.keys(f.files)) owner.set(p, name);
  const filesFields = Object.entries(pulled.fields).filter(([, f]) => f.kind === 'files').map(([n]) => n);
  const values: Record<string, Record<string, string>> = {};
  for (const name of Object.keys(pulled.fields)) values[name] = {};
  for (const [path, text] of Object.entries(folder)) {
    if (TOOLING.has(path)) continue;
    let field = owner.get(path);
    if (!field) {
      if (filesFields.length !== 1) throw new Error(`${path} is new, and ${pulled.type} has ${filesFields.length ? 'more than one field' : 'no field'} of files to put it in`);
      field = filesFields[0];
    }
    values[field][path] = text;
  }
  const props: Record<string, unknown> = {}, changed: string[] = [];
  for (const [name, f] of Object.entries(pulled.fields)) {
    const now = values[name];
    const same = Object.keys(now).length === Object.keys(f.files).length && Object.entries(now).every(([p, t]) => f.files[p] === sha(t));
    if (same) continue;
    changed.push(...[...new Set([...Object.keys(now), ...Object.keys(f.files)])].filter((p) => f.files[p] !== (now[p] === undefined ? undefined : sha(now[p]))));
    props[name] = f.kind === 'text' ? (Object.values(now)[0] ?? '') : now;
  }
  return { props, changed: changed.sort() };
}

/** Which of the pulled fields the map holds differently now: the map moved under the folder. */
export function moved(pulled: Pulled, fields: CodeField[], props: Record<string, unknown>): string[] {
  const now = record(pulled, fields, toFiles(fields, props));
  return Object.keys({ ...pulled.fields, ...now.fields }).filter((name) => {
    const a = pulled.fields[name]?.files ?? {}, b = now.fields[name]?.files ?? {};
    return Object.keys(a).length !== Object.keys(b).length || Object.entries(a).some(([p, h]) => b[p] !== h);
  });
}
