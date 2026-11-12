// Keeps the Pack anatomy island in step with the code, from git: this repository and the hosted one (archipelago-hosted
// beside the main checkout, or --hosted <folder>) at a ref (origin/main by default). The island's sync item says which
// commits it stands at; a run asks git what changed since, and redoes only what that reaches (packs/anatomy_sync/
// extract.ts, runOf): a module edited redoes that module, a file moved keeps its item. With --full, or on an island
// that has never been synced, every file is read: the full check, which must leave the island as the changes did.
// The difference goes as one change (packs/anatomy_sync/plan.ts), with the sync item brought to the new commits.
// Run it from any worktree (git fetch both repositories first):
//
//   node scripts/anatomy.ts [--full] [--dry] [--ref origin/main] [--hosted <folder>] [--run <run id>]
//
// It acts on the map PELAGO_URL names with PELAGO_AGENT_TOKEN (never printed), on the island that speaks the anatomy
// pack. What a person added there is left alone: only what the extractors key is archived, and only the sync's own link
// types from an item it still wants are taken back.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extract, fullRun, read, readsIn, runOf, type Change, type Run } from '../packs/anatomy_sync/extract.ts';
import { keyOf, type Source } from '../packs/anatomy_sync/model.ts';
import { plan, type Held, type Island } from '../packs/anatomy_sync/plan.ts';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const DRY = process.argv.includes('--dry');
const FULL = process.argv.includes('--full');
const REF = arg('ref') ?? 'origin/main';
const RUN = arg('run') ?? process.env.PELAGO_RUN;
const ONE_CHANGE = 1500; // ops a change is sent in whole; a first fill past it goes in parts

const git = (repo: string, args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const CORE = resolve(import.meta.dirname, '..');
const beside = resolve(git(CORE, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim(), '..', '..', 'archipelago-hosted');
const HOSTED = arg('hosted') ? resolve(arg('hosted')!) : beside;
if (!existsSync(HOSTED)) throw new Error(`No hosted repository at ${HOSTED}: give --hosted its folder. Without it every hosted pack on the island would be archived.`);
const REPOS: [string, Source['repo'], string][] = [[CORE, 'open_core', 'archipelago'], [HOSTED, 'hosted', 'archipelago-hosted']];

/** The files a run reads in a repository at the ref, with their blob hashes, read in one pass of git cat-file. */
function sources(repo: string, which: Source['repo'], wanted: (path: string) => boolean): Source[] {
  const listed = git(repo, ['ls-tree', '-r', REF]).split('\n').flatMap((line) => {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    return m && read(m[2]) && wanted(m[2]) ? [{ blob: m[1], path: m[2] }] : [];
  });
  if (!listed.length) return [];
  const out = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], { input: listed.map((f) => f.blob).join('\n') + '\n', maxBuffer: 1 << 28 });
  const files: Source[] = [];
  let at = 0;
  for (const f of listed) {
    const nl = out.indexOf(10, at), size = Number(out.subarray(at, nl).toString().split(' ')[2]);
    files.push({ ...f, repo: which, text: out.subarray(nl + 1, nl + 1 + size).toString('utf8') });
    at = nl + 1 + size + 1;
  }
  return files;
}

/** What changed in a repository between two commits, as git's diff names it, renames followed. */
const changesSince = (repo: string, from: string): Change[] =>
  git(repo, ['diff', '--name-status', '-M', from, REF]).split('\n').flatMap((line) => {
    const [status, a, b] = line.split('\t');
    if (!status) return [];
    if (status.startsWith('R')) return [{ status: 'R' as const, from: a, path: b }];
    if (status.startsWith('C')) return [{ status: 'A' as const, path: b }];
    return [{ status: (status[0] === 'D' ? 'D' : status[0] === 'A' ? 'A' : 'M') as Change['status'], path: a }];
  });

async function call(tool: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${process.env.PELAGO_URL}/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.PELAGO_AGENT_TOKEN}` }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${tool}: ${r.status} ${t.slice(0, 2000)}`);
  const j = JSON.parse(t), res = j.result ?? j;
  if (tool === 'change' && res.status !== 'applied') throw new Error(`change ${res.status}: ${t.slice(0, 2000)}`);
  return res;
}
const query = (name: string, params: Record<string, unknown>) => call('query', { name, params });

/** What the island holds: its items with their fields and notes, keyed as the extractors key them, and its links. */
async function readIsland(): Promise<Island & { bulk: boolean }> {
  const islands = (await query('search', { type: 'island', q: 'anatomy', full: true })) as Held[];
  const island = islands.find((i) => i.props?.pack === 'anatomy');
  if (!island) throw new Error('No island speaks the anatomy pack here: add the pack and make its island first.');
  let flat: any;
  try { flat = await query('flat', { filter: { find: [`island ${island.id}`] }, limit: 2000, fields: true }); } catch { flat = undefined; }
  // A server that knows `fields: true` sends every declared field, the island among them; one that does not sends only
  // the fields each type shows, and is read item by item.
  const bulk = !!flat?.items?.length && flat.items.every((i: any) => !i.type.startsWith('anatomy.') || i.fields?.island !== undefined);
  if (!bulk) flat = await query('flat', { filter: { find: [`island ${island.id}`] }, limit: 2000 });
  if (flat.items.length >= 2000) throw new Error('The island holds 2000 items or more, past what one query answers: read it in parts.');
  const items = new Map<string, Held>();
  if (bulk) for (const i of flat.items) items.set(i.id, { id: i.id, type: i.type, title: i.title, body: i.body ?? '', props: i.fields ?? {} });
  else {
    const notes = new Map<string, string>(flat.items.map((i: Held) => [i.id, i.body ?? '']));
    for (const type of new Set<string>(flat.items.map((i: Held) => i.type))) for (const i of (await query('search', { type, limit: 200, full: true })) as Held[]) if (notes.has(i.id)) items.set(i.id, { ...i, body: notes.get(i.id)! });
    for (const i of flat.items as Held[]) if (!items.has(i.id) && i.type.startsWith('anatomy.')) items.set(i.id, (await query('get', { id: i.id, full: true })).entity);
  }
  const links = flat.links as Island['links'];
  const packOf = new Map<string, string>();
  for (const l of links) if (l.type === 'part_of' && items.get(l.to)?.type === 'anatomy.pack') packOf.set(l.from, String(items.get(l.to)!.props.pack_id));
  const byKey = new Map<string, Held>(), keyById = new Map<string, string>();
  for (const i of items.values()) { const k = keyOf(i.type, i.props, packOf.get(i.id)); if (k && !byKey.has(k)) { byKey.set(k, i); keyById.set(i.id, k); } }
  return { island: island.id, byKey, keyById, links, bulk };
}

const island = await readIsland();
const heads = Object.fromEntries(REPOS.map(([repo, , name]) => [name, git(repo, ['rev-parse', REF]).trim()]));
const was = Object.fromEntries(String(island.byKey.get('sync')?.props.commits ?? '').split('\n').filter(Boolean).map((l) => l.split('@') as [string, string]));
const incremental = !FULL && REPOS.every(([, , name]) => was[name]);
const changes = incremental ? REPOS.flatMap(([repo, , name]) => changesSince(repo, was[name]).filter((c) => c.status !== 'D' || read(c.path))) : [];
const run: Run = incremental ? runOf(changes) : fullRun();
const reads = readsIn(run);
const files = REPOS.flatMap(([repo, which]) => (run.extractors.length ? sources(repo, which, reads) : []));
const want = extract(files, run, new Set(island.byKey.keys()));
const commits = REPOS.map(([, , name]) => `${name}@${heads[name]}`).join('\n');
const moved = REPOS.some(([, , name]) => was[name] !== heads[name]);
if (moved || !incremental) want.items.push({ key: 'sync', type: 'anatomy.sync', title: 'Where the island stands', body: '', props: { commits, full: !incremental } });
const { ops, counts } = plan(want, island, run);
if (arg('out')) (await import('node:fs')).writeFileSync(arg('out')!, JSON.stringify(ops, null, 1));
console.log(`${incremental ? `${changes.length} files changed since the last sync` : 'full run'}; ${run.extractors.map((e) => `${e.extractor.id}${e.only ? ` (${e.only.size})` : ''}`).join(', ') || 'no extractor reached'}; ${files.length} files read (${island.bulk ? 'island read in bulk' : 'island read item by item'}); ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}`);

const reason = `Pack anatomy: the island brought to ${heads.archipelago.slice(0, 8)} and hosted ${heads['archipelago-hosted'].slice(0, 8)}${incremental ? ', from what changed' : ', in full'}`;
const authority = { of: 'agent', basis: `The code at ${REF}, read by packs/anatomy_sync's extractors (scripts/anatomy.ts).` };
const send = (why: string, part: Record<string, unknown>[]) => call('change', { ...(RUN && { run: RUN }), authority, reason: why, ops: part });
if (DRY || !ops.length) console.log(DRY ? `would send ${ops.length} ops` : 'nothing to change');
else if (ops.length <= ONE_CHANGE) { await send(reason, ops); console.log(`sent ${ops.length} ops in one change`); }
else {
  // A first fill is past one change: items first, in parts, then the links between them, which need their ids.
  const made = new Map<string, string>();
  const items = ops.filter((o) => o.op !== 'link' && o.op !== 'unlink');
  for (let i = 0; i < items.length; i += 300) for (const [r, eid] of Object.entries<string>((await send(`${reason} (items, part ${i / 300 + 1})`, items.slice(i, i + 300))).created ?? {})) made.set(r, eid);
  const rest = ops.filter((o) => o.op === 'link' || o.op === 'unlink').map((o) => (o.op === 'link' ? { ...o, from: made.get(o.from as string) ?? o.from, to: made.get(o.to as string) ?? o.to } : o));
  for (let i = 0; i < rest.length; i += 500) await send(`${reason} (links, part ${i / 500 + 1})`, rest.slice(i, i + 500));
  console.log(`sent ${ops.length} ops in parts`);
}
