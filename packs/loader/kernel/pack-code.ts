// A pack's code on the log (task e_7vezatrt, docs/log.md section 8): the files of a pack's folder that run or are
// served (its handler and what it imports, its layouts' modules, its pages), each kept by the SHA-256 of its text.
// A pack fact names them beside its manifest: `code`, the hash of the whole, and `files`, each path's hash; `texts`
// holds a file's text the first time the log meets its hash, so a server that changes one file adds that file alone.
//
// Code read back from the log, or a version's own code over its pack's (packs/loader/kernel/pack-items.ts), is laid out in a folder
// kept by the hash of the whole, so a handler runs from it under the same walls as from the pack's own folder
// (packs/loader/kernel/packhost.ts: read access to that folder alone) and a layout's modules are read from it as from the pack's.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Q } from '../../database/kernel/db.ts';

/** A pack's code as a pack fact names it: the hash of the whole, and each file's hash by its path. */
export interface PackCode {
  code: string;
  files: Record<string, string>;
}

/** A path a pack's code may have: relative, by / alone, of plain names, none of them . or .. */
const PATH = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;
/** What is code in a pack's folder: what runs, what is served. Its manifest, its words and its tests are not. */
const KEPT = /\.(?:js|mjs|cjs|css|html|json|svg|txt)$/;
const SKIPPED = /(?:^|\/)(?:pack\.json|[^/]*\.test\.[a-z]+|test|tests|node_modules)$/;

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** Whether a path may name a file of a pack's code. */
export const codePath = (path: string) => PATH.test(path) && KEPT.test(path) && !SKIPPED.test(path);

/** The hash of a pack's code, from each file's hash by its path. */
export const codeHash = (files: Record<string, string>) => sha(Object.keys(files).sort().map((p) => `${p}\0${files[p]}\n`).join(''));

/** A pack's code read from its folder, by its path, as text. */
function readCode(folder: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, at: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = at ? `${at}/${name.name}` : name.name;
      if (name.name.startsWith('.') || SKIPPED.test(path)) continue;
      if (name.isDirectory()) walk(join(dir, name.name), path);
      else if (name.isFile() && codePath(path)) out[path] = readFileSync(join(dir, name.name), 'utf8');
    }
  };
  if (existsSync(folder)) walk(folder, '');
  return out;
}

/** What each folder was read as, by a mark of its files' sizes and times: read again only when one changes. */
const read = new Map<string, { mark: string; texts: Record<string, string> }>();
function markOf(folder: string): string {
  const parts: string[] = [];
  const walk = (dir: string, at: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = at ? `${at}/${name.name}` : name.name;
      if (name.name.startsWith('.') || SKIPPED.test(path)) continue;
      if (name.isDirectory()) walk(join(dir, name.name), path);
      else if (codePath(path)) { const s = statSync(join(dir, name.name)); parts.push(`${path}:${s.size}:${s.mtimeMs}`); }
    }
  };
  if (existsSync(folder)) walk(folder, '');
  return parts.join('|');
}

/** A pack folder's code as text by path; empty when it has none. */
export function codeTexts(folder: string): Record<string, string> {
  const mark = markOf(folder), was = read.get(folder);
  if (was?.mark === mark) return was.texts;
  const texts = readCode(folder);
  read.set(folder, { mark, texts });
  return texts;
}

/** A pack's code as a fact names it, from its texts by path; undefined when it has none. */
export function codeOf(texts: Record<string, string>): (PackCode & { texts: Map<string, string> }) | undefined {
  const paths = Object.keys(texts);
  if (!paths.length) return undefined;
  const files: Record<string, string> = {}, byHash = new Map<string, string>();
  for (const p of paths) byHash.set((files[p] = sha(texts[p])), texts[p]);
  return { code: codeHash(files), files, texts: byHash };
}

/** The code of a pack's folder as a fact names it; undefined when it has none. */
export const folderCode = (folder: string) => codeOf(codeTexts(folder));

/** Where code read back is laid out: a folder per code, by its hash. */
const ROOT = () => join(tmpdir(), 'pelago-code');

/**
 * Lay a pack's code out in a folder kept by its hash, and give back the folder that holds the pack's folder (what a
 * registry's folderOf joins the pack's id to). One already laid out is used again once each file reads as its hash.
 */
export function layOut(pack: string, texts: Record<string, string>): string {
  const bad = Object.keys(texts).filter((p) => !codePath(p));
  if (bad.length) throw new Error(`a pack's code is files by plain relative paths (.js, .css, .html...): not ${bad.join(', ')}`);
  const { code, files } = codeOf(texts) ?? { code: codeHash({}), files: {} };
  const where = join(ROOT(), code), folder = join(where, pack);
  const whole = () => Object.entries(files).every(([p, h]) => existsSync(join(folder, p)) && sha(readFileSync(join(folder, p), 'utf8')) === h);
  if (existsSync(folder) && whole()) return where;
  // Written beside, then moved into place whole, so a reader never meets half of it.
  const temp = join(ROOT(), `${code}.${randomBytes(6).toString('hex')}`);
  for (const [p, text] of Object.entries(texts)) {
    mkdirSync(dirname(join(temp, pack, p)), { recursive: true });
    writeFileSync(join(temp, pack, p), text);
  }
  mkdirSync(join(temp, pack), { recursive: true });
  rmSync(where, { recursive: true, force: true });
  try {
    renameSync(temp, where);
  } catch (err) {
    rmSync(temp, { recursive: true, force: true });
    if (!(existsSync(folder) && whole())) throw err;
  }
  return where;
}

/** The texts the log keeps of these file hashes. */
export async function keptTexts(q: Q, hashes: string[]): Promise<Map<string, string>> {
  if (!hashes.length) return new Map();
  const { rows } = await q.query<{ hash: string; text: string }>(`select t.key as hash, t.value #>> '{}' as text from log_fact, jsonb_each(log_fact.value->'texts') t where stream = 'facts' and field = 'pack' and id like 'pack:%' and log_fact.value ? 'texts' and t.key = any($1::text[]) -- index log_fact_kept`, [hashes]);
  return new Map(rows.map((r) => [r.hash, r.text]));
}

/** The file hashes whose texts this log keeps. */
export async function keptHashes(q: Q): Promise<Set<string>> {
  const { rows } = await q.query<{ hash: string }>(`select distinct jsonb_object_keys(value->'texts') as hash from log_fact where stream = 'facts' and field = 'pack' and id like 'pack:%' and value ? 'texts' -- index log_fact_kept`);
  return new Set(rows.map((r) => r.hash));
}

/** Read back from the log: a pack's code laid out by the files a fact named, or why it cannot be (a text the log lacks). */
export async function codeFromLog(q: Q, pack: string, files: Record<string, string>): Promise<string | Error> {
  const texts = await keptTexts(q, [...new Set(Object.values(files))]);
  const lacking = Object.entries(files).filter(([, h]) => !texts.has(h)).map(([p]) => p);
  if (lacking.length) return new Error(`the log keeps no text of ${lacking.join(', ')}`);
  return layOut(pack, Object.fromEntries(Object.entries(files).map(([p, h]) => [p, texts.get(h)!])));
}

/** Why a version's own code may not be taken, as sentences: none when it may. `server`: whether its pack is a server's, with a folder. */
export function versionCodeProblems(code: unknown, of: string, server: boolean): string[] {
  if (code === undefined || code === null) return [];
  if (!code || typeof code !== 'object' || Array.isArray(code)) return ['its code is an object of files by path, each a text'];
  if (!server) return [`${of} is a pack kept as an item, which runs no code: only a version of a server's pack may carry code`];
  const entries = Object.entries(code as Record<string, unknown>);
  const bad = entries.filter(([p, t]) => !codePath(p) || typeof t !== 'string').map(([p]) => p);
  return bad.length ? [`its code is files by plain relative paths (.js, .css, .html...), each a text: not ${bad.join(', ')}`] : [];
}

/** The folder that holds a version's pack folder: its pack's code, its own files over them by path. */
export const versionWhere = (pack: string, base: string, code: Record<string, string>) => layOut(pack, { ...codeTexts(base), ...code });

/** What a code field's value is called as a file when it is one text: a stylesheet's or a module's. */
const ONE = (f: { css?: boolean }) => (f.css ? 'index.css' : 'index.js');
const fieldsOf = new WeakMap<object, Map<string, string>>();
/**
 * The fields a registry's types declare as code, each to the name its value has as a file when it is one text: what the
 * log stores as files by hash (packs/seal/kernel/code-files.ts). By name across types: a field of that name that holds
 * no code reads back as it was written all the same.
 */
export function codeFields(reg: { types: Map<string, { fields: Record<string, { code?: boolean; css?: boolean }> }> }): Map<string, string> {
  let out = fieldsOf.get(reg.types);
  if (!out) {
    out = new Map();
    for (const t of reg.types.values()) for (const [k, f] of Object.entries(t.fields)) if (f.code && !out.has(k)) out.set(k, ONE(f));
    fieldsOf.set(reg.types, out);
  }
  return out;
}
