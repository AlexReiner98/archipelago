// Code kept on the map, worked on as files (task e_ahu6xmuv; the path agreed by the owner, 14 Nov 2026, e_pjb56hte):
//
//   node scripts/map-code.ts pull <item> [folder]   lay the item's code fields out as files (scripts/map-code-files.ts)
//   node scripts/map-code.ts push [folder]          send what changed as one change, refused if the map moved since
//   node scripts/map-code.ts watch [folder]         push on each save; with --preview, send each save as a preview
//   node scripts/map-code.ts status [folder]        what changed here, and whether the map moved
//
// The folder defaults to .map-code/<item> under the repository (ignored by git). The log stays the record: a push is
// one ordinary change through the one write path, on the agent's own authority, held for the human where the map's
// rules hold code (code_runs); git is not a second record. The map is the one PELAGO_URL names, with
// PELAGO_AGENT_TOKEN (never printed); --map <name> takes an MCP server of that name instead (as npm run pull does),
// --url a server with no token (the local one on 3100). --force pushes over a map that moved; --run names the run.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { codeFields, fromFiles, moved, record, toFiles, TOOLING, type CodeField, type Pulled } from './map-code-files.ts';
import { codePath } from '../packs/loader/kernel/pack-code.ts';

export type Call = (tool: string, body: Record<string, unknown>) => Promise<any>;

const MANIFEST = '.map-code.json';
const ROOT = resolve(import.meta.dirname, '..');
/** The drawing contract's types, copied into a folder for tsc's checkJs when the repository has them (task e_p5s9br82). */
const TYPES = join(ROOT, 'packs', 'walls', 'page', 'draw.d.ts');

/** A call to a map's agent tools over HTTP, answering the tool's result. */
export function httpCall(url: string, token?: string): Call {
  return async (tool, body) => {
    const r = await fetch(`${url.replace(/\/$/, '')}/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
    const text = await r.text();
    let j: any;
    try { j = JSON.parse(text); } catch { throw new Error(`${tool}: ${r.status} ${text.slice(0, 200)}`); }
    if (!r.ok || j.error) throw new Error(`${tool}: ${typeof j.error === 'string' ? j.error : JSON.stringify(j.error ?? j).slice(0, 600)}`);
    return j.result ?? j;
  };
}

/** The item as the map holds it now, with its type's code fields. */
async function read(call: Call, id: string): Promise<{ entity: any; fields: CodeField[] }> {
  const got = await call('query', { name: 'get', params: { id, full: true } });
  const entity = got.entity ?? got;
  if (!entity?.type) throw new Error(`${id}: no such item`);
  const schema = await call('query', { name: 'schema', params: { type: entity.type, full: true } });
  const type = (schema.types ?? []).find((t: any) => t.id === entity.type);
  const fields = codeFields(type?.fields ?? {});
  if (!fields.length) throw new Error(`${entity.title} (${entity.type}) has no code fields`);
  return { entity, fields };
}

/** A folder's files by relative path, as text: what a push reads. */
export function readFolder(folder: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(dir, e.name), path = relative(folder, full).replaceAll('\\', '/');
      if (e.isDirectory()) walk(full);
      else if (!TOOLING.has(path) && codePath(path)) out[path] = readFileSync(full, 'utf8');
    }
  };
  walk(folder);
  return out;
}

const manifestOf = (folder: string): Pulled => {
  const at = join(folder, MANIFEST);
  if (!existsSync(at)) throw new Error(`${folder} was not pulled: no ${MANIFEST} (map-code pull <item> first)`);
  return JSON.parse(readFileSync(at, 'utf8'));
};

/** Pull an item's code into a folder: its files, what they were pulled as, and the types to check them by. */
export async function pull(call: Call, url: string, id: string, folder: string): Promise<Pulled> {
  const { entity, fields } = await read(call, id);
  const laid = toFiles(fields, entity.props ?? {});
  if (existsSync(join(folder, MANIFEST))) {
    const was = manifestOf(folder), here = fromFiles(was, readFolder(folder));
    if (here.changed.length) throw new Error(`${folder} has changes not pushed (${here.changed.join(', ')}): push them, or remove the folder`);
    for (const f of Object.values(was.fields)) for (const p of Object.keys(f.files)) rmSync(join(folder, p), { force: true });
  }
  mkdirSync(folder, { recursive: true });
  for (const [path, text] of Object.entries(laid.files)) {
    mkdirSync(join(folder, path, '..'), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  const pulled = record({ url, item: entity.id, type: entity.type, title: entity.title, updated_at: entity.updated_at }, fields, laid);
  writeFileSync(join(folder, MANIFEST), JSON.stringify(pulled, null, 2) + '\n');
  if (existsSync(TYPES) && fields.some((f) => f.kind === 'text' ? !f.css : true)) {
    copyFileSync(TYPES, join(folder, 'draw.d.ts'));
    writeFileSync(join(folder, 'jsconfig.json'), JSON.stringify({ compilerOptions: { checkJs: true, allowJs: true, noEmit: true, strict: false, target: 'es2022', module: 'es2022', moduleResolution: 'bundler', lib: ['es2022', 'webworker'] }, include: ['**/*.js', 'draw.d.ts'] }, null, 2) + '\n');
  }
  return pulled;
}

export interface Pushed {
  status: 'unchanged' | 'applied' | 'held' | 'moved';
  changed: string[];
  /** The fields the map holds differently than when pulled, when it moved. */
  moved?: string[];
  /** The rule that held it, when held; the proposal. */
  held_by?: unknown;
  proposal?: string;
}

/** What changed in the folder since the pull, and whether the map moved under it. */
export async function status(call: Call, folder: string): Promise<{ changed: string[]; moved: string[] }> {
  const pulled = manifestOf(folder);
  const { changed } = fromFiles(pulled, readFolder(folder));
  const { entity, fields } = await read(call, pulled.item);
  return { changed, moved: moved(pulled, fields, entity.props ?? {}) };
}

/**
 * Send what changed in the folder as one change. Refused when the map moved since the pull (unless force); applied, the
 * folder's record moves to what was sent; held, it stays where it was, so a second push sends the same again.
 */
export async function push(call: Call, folder: string, opts: { force?: boolean; run?: string; reason?: string } = {}): Promise<Pushed> {
  const pulled = manifestOf(folder);
  const { props, changed } = fromFiles(pulled, readFolder(folder));
  if (!changed.length) return { status: 'unchanged', changed };
  const { entity, fields } = await read(call, pulled.item);
  const away = moved(pulled, fields, entity.props ?? {});
  if (away.length && !opts.force) return { status: 'moved', changed, moved: away };
  const res = await call('change', {
    ...(opts.run && { run: opts.run }),
    reason: opts.reason ?? `map-code push: ${changed.join(', ')} of ${pulled.title}`,
    authority: { of: 'agent', basis: `map-code push of the files in ${relative(ROOT, folder).replaceAll('\\', '/') || folder}` },
    source: { kind: 'file', uri: changed.map((p) => `${relative(ROOT, join(folder, p)).replaceAll('\\', '/')}`).join(', ').slice(0, 500) },
    ops: [{ op: 'update', id: pulled.item, props }],
  });
  if (res.status === 'applied') {
    const now = await read(call, pulled.item);
    const laid = toFiles(now.fields, now.entity.props ?? {});
    writeFileSync(join(folder, MANIFEST), JSON.stringify(record({ ...pulled, updated_at: now.entity.updated_at }, now.fields, laid), null, 2) + '\n');
    return { status: 'applied', changed };
  }
  if (res.status === 'proposed' || res.status === 'held' || res.proposal) return { status: 'held', changed, held_by: res.held_by, proposal: res.proposal };
  throw new Error(`change ${res.status ?? 'refused'}: ${JSON.stringify(res).slice(0, 600)}`);
}

/**
 * Send what the folder holds as a preview of the item (task e_p5zjynrb): off the log, seen only by the sender's open
 * pages. Each changed field whole, as change would send it.
 */
export async function preview(call: Call, folder: string, discard = false): Promise<{ changed: string[] }> {
  const pulled = manifestOf(folder);
  const { props, changed } = fromFiles(pulled, readFolder(folder));
  const names = discard ? Object.keys(pulled.fields) : Object.keys(props);
  for (const field of names) await call('report', { action: 'preview', params: discard ? { item: pulled.item, field, discard: true } : { item: pulled.item, field, value: props[field] } });
  return { changed };
}

/** Push (or preview) on each save, a save being quiet for a moment; answers a stop. */
export function watchFolder(folder: string, onSave: () => Promise<void>, quiet = 120): () => void {
  let timer: NodeJS.Timeout | undefined, running = Promise.resolve();
  const w = watch(folder, { recursive: true }, (_e, name) => {
    const path = String(name ?? '').replaceAll('\\', '/');
    if (!path || path.startsWith('.') || TOOLING.has(path)) return;
    clearTimeout(timer);
    timer = setTimeout(() => { running = running.then(onSave).catch((err) => console.error(String(err?.message ?? err))); }, quiet);
  });
  return () => { clearTimeout(timer); w.close(); };
}

/** The map to call: --url (no token), --map <name> (an MCP server, as npm run pull finds it), else PELAGO_URL. */
async function target(args: Map<string, string | true>): Promise<{ url: string; call: Call }> {
  const url = args.get('url'), name = args.get('map');
  if (typeof url === 'string') return { url, call: httpCall(url) };
  if (typeof name === 'string') {
    const { connection } = await import('./pull.ts');
    const c = connection(name);
    if (!c) throw new Error(`no MCP server named ${name} reaches here`);
    return { url: c.url, call: httpCall(c.url, c.token) };
  }
  const base = process.env.PELAGO_URL, token = process.env.PELAGO_AGENT_TOKEN;
  if (!base) throw new Error('Set PELAGO_URL (and PELAGO_AGENT_TOKEN), or give --url or --map');
  return { url: base, call: httpCall(base, token) };
}

const say = (r: Pushed) =>
  r.status === 'unchanged' ? 'nothing changed'
  : r.status === 'moved' ? `refused: the map changed ${r.moved!.join(', ')} since the pull; pull again (or --force)`
  : r.status === 'held' ? `held for the human (${JSON.stringify(r.held_by ?? 'a rule')}${r.proposal ? `, ${r.proposal}` : ''}): ${r.changed.join(', ')}`
  : `applied: ${r.changed.join(', ')}`;

async function main() {
  const [verb, ...rest] = process.argv.slice(2);
  const args = new Map<string, string | true>(), plain: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) plain.push(a);
    else if (['url', 'map', 'run', 'reason'].includes(a.slice(2))) args.set(a.slice(2), rest[++i]);
    else args.set(a.slice(2), true);
  }
  const folderOf = (p?: string) => resolve(p ?? process.cwd());
  const runArg = typeof args.get('run') === 'string' ? (args.get('run') as string) : process.env.PELAGO_RUN;
  if (verb === 'pull') {
    const id = plain[0];
    if (!id) throw new Error('map-code pull <item> [folder]');
    const { url, call } = await target(args);
    const folder = resolve(plain[1] ?? join(ROOT, '.map-code', id));
    const p = await pull(call, url, id, folder);
    console.log(`${p.title}: ${Object.values(p.fields).flatMap((f) => Object.keys(f.files)).join(', ') || 'no code yet'} in ${folder}`);
  } else if (verb === 'push' || verb === 'status') {
    const folder = folderOf(plain[0]);
    const { call } = await target(args);
    if (verb === 'status') { const s = await status(call, folder); console.log(`changed here: ${s.changed.join(', ') || 'nothing'}; moved on the map: ${s.moved.join(', ') || 'nothing'}`); return; }
    console.log(say(await push(call, folder, { force: args.has('force'), run: runArg, reason: args.get('reason') as string | undefined })));
  } else if (verb === 'watch') {
    const folder = folderOf(plain[0]);
    const { call } = await target(args);
    const asPreview = args.has('preview');
    manifestOf(folder);
    console.log(`watching ${folder}: each save ${asPreview ? 'previewed on your open pages' : 'pushed'}; Ctrl+C to stop`);
    watchFolder(folder, async () => {
      if (asPreview) { const r = await preview(call, folder); console.log(`previewed: ${r.changed.join(', ') || 'as pulled'}`); }
      else console.log(say(await push(call, folder, { force: args.has('force'), run: runArg })));
    });
  } else if (verb === 'discard') {
    const { call } = await target(args);
    await preview(call, folderOf(plain[0]), true);
    console.log('preview dropped');
  } else {
    console.log('map-code pull <item> [folder] | push [folder] | watch [folder] [--preview] | discard [folder] | status [folder]');
  }
}

if (import.meta.main) await main().catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });

