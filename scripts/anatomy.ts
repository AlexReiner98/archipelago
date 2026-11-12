// The full check of the Pack anatomy island: reads every file the anatomy sync's extractors own (packs/anatomy_sync/
// extract.ts) at a git ref (origin/main by default) of this repository and of the hosted one (archipelago-hosted beside
// the main checkout, or --hosted <folder>); works out what the island should hold; reads what it holds; and sends the
// difference as one change: new items and links, items whose title, note or fields moved, what no file declares any
// more archived or unlinked, and the sync item saying which commits the island now stands at. Run it from any worktree
// (git fetch both repositories first):
//
//   node scripts/anatomy.ts [--dry] [--ref origin/main] [--hosted <folder>] [--run <run id>]
//
// It acts on the map PELAGO_URL names with PELAGO_AGENT_TOKEN (never printed), on the island that speaks the anatomy
// pack. What a person added there is left alone: only what the extractors key is archived (never a module), and only
// the sync's own link types from an item it still wants are unlinked.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extract, read } from '../packs/anatomy_sync/extract.ts';
import { keyOf, MADE_LINKS, type Source, type Want } from '../packs/anatomy_sync/model.ts';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const DRY = process.argv.includes('--dry');
const REF = arg('ref') ?? 'origin/main';
const RUN = arg('run') ?? process.env.PELAGO_RUN;
const ONE_CHANGE = 1500; // ops a change is sent in whole; a first fill past it goes in parts

const git = (repo: string, args: string[], input?: string) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, ...(input !== undefined && { input }) });
const CORE = resolve(import.meta.dirname, '..');
const beside = resolve(git(CORE, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim(), '..', '..', 'archipelago-hosted');
const HOSTED = arg('hosted') ? resolve(arg('hosted')!) : beside;
if (!existsSync(HOSTED)) throw new Error(`No hosted repository at ${HOSTED}: give --hosted its folder. Without it every hosted pack on the island would be archived.`);

/** Every file the extractors read in a repository at the ref, with its blob hash, read in one pass of git cat-file. */
function sources(repo: string, which: Source['repo']): { files: Source[]; commit: string } {
  const commit = git(repo, ['rev-parse', REF]).trim();
  const listed = git(repo, ['ls-tree', '-r', REF]).split('\n').flatMap((line) => {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    return m && read(m[2]) ? [{ blob: m[1], path: m[2] }] : [];
  });
  const out = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], { input: listed.map((f) => f.blob).join('\n') + '\n', maxBuffer: 1 << 28 });
  const files: Source[] = [];
  let at = 0;
  for (const f of listed) {
    const nl = out.indexOf(10, at), size = Number(out.subarray(at, nl).toString().split(' ')[2]);
    files.push({ ...f, repo: which, text: out.subarray(nl + 1, nl + 1 + size).toString('utf8') });
    at = nl + 1 + size + 1;
  }
  return { files, commit };
}

async function call(tool: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${process.env.PELAGO_URL}/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.PELAGO_AGENT_TOKEN}` }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${tool}: ${r.status} ${t.slice(0, 2000)}`);
  const j = JSON.parse(t), res = j.result ?? j;
  if (tool === 'change' && res.status !== 'applied') throw new Error(`change ${res.status}: ${t.slice(0, 2000)}`);
  return res;
}
const query = (name: string, params: Record<string, unknown>) => call('query', { name, params });

interface Have { id: string; type: string; title: string; body: string; props: Record<string, any> }
/** What the island holds: its items with their fields and notes whole, keyed as the extractors key them, and its links. */
async function readIsland() {
  const islands = (await query('search', { type: 'island', q: 'anatomy', full: true })) as Have[];
  const island = islands.find((i) => i.props?.pack === 'anatomy');
  if (!island) throw new Error('No island speaks the anatomy pack here: add the pack and make its island first.');
  let flat: any;
  try { flat = await query('flat', { filter: { find: [`island ${island.id}`] }, limit: 2000, fields: true }); } catch { flat = undefined; }
  // A server that knows `fields: true` sends every declared field, the island among them; one that does not sends only
  // the fields each type shows, and is read item by item.
  const bulk = !!flat?.items?.length && flat.items.every((i: any) => !i.type.startsWith('anatomy.') || i.fields?.island !== undefined);
  if (!bulk) flat = await query('flat', { filter: { find: [`island ${island.id}`] }, limit: 2000 });
  if (flat.items.length >= 2000) throw new Error('The island holds 2000 items or more, past what one query answers: read it in parts.');
  const items = new Map<string, Have>();
  if (bulk) for (const i of flat.items) items.set(i.id, { id: i.id, type: i.type, title: i.title, body: i.body ?? '', props: i.fields ?? {} });
  else { // a server without flat's fields: search answers fields (200 of a type), get the rest
    const notes = new Map<string, string>(flat.items.map((i: Have) => [i.id, i.body ?? '']));
    for (const type of new Set<string>(flat.items.map((i: Have) => i.type))) for (const i of (await query('search', { type, limit: 200, full: true })) as Have[]) if (notes.has(i.id)) items.set(i.id, { ...i, body: notes.get(i.id)! });
    for (const i of flat.items as Have[]) if (!items.has(i.id) && i.type.startsWith('anatomy.')) items.set(i.id, (await query('get', { id: i.id, full: true })).entity);
  }
  const links = flat.links as { id: string; type: string; from: string; to: string }[];
  const packOf = new Map<string, string>();
  for (const l of links) if (l.type === 'part_of' && items.get(l.to)?.type === 'anatomy.pack') packOf.set(l.from, String(items.get(l.to)!.props.pack_id));
  const byKey = new Map<string, Have>(), keyById = new Map<string, string>();
  for (const i of items.values()) { const k = keyOf(i.type, i.props, packOf.get(i.id)); if (k && !byKey.has(k)) { byKey.set(k, i); keyById.set(i.id, k); } }
  return { island: island.id, byKey, keyById, links, bulk };
}

/** A note the query cut ends in an ellipsis: it is the same when the whole one starts with what was kept. */
const sameNote = (w: string, h: string) => w === h || (h.endsWith('…') && w.startsWith(h.slice(0, -1).trimEnd()));
const same = (w: Want, h: Have) => w.title === h.title && sameNote(w.body || '', h.body || '') && Object.entries(w.props).every(([k, v]) => h.props?.[k] === v);

const core = sources(CORE, 'open_core'), hosted = sources(HOSTED, 'hosted');
const want = extract([...core.files, ...hosted.files]);
const have = await readIsland();
const id = (key: string) => have.byKey.get(key)?.id;
const commits = `archipelago@${core.commit}\narchipelago-hosted@${hosted.commit}`;
want.items.push({ key: 'sync', type: 'anatomy.sync', title: 'Where the island stands', body: '', props: { commits, full: true } });

// Items: made, changed, archived (never a module: a person may have tied one).
const wanted = new Set(want.items.map((w) => w.key));
const create = want.items.filter((w) => !id(w.key));
const update = want.items.filter((w) => id(w.key) && !same(w, have.byKey.get(w.key)!));
const gone = [...have.byKey].filter(([k, h]) => !wanted.has(k) && h.type !== 'anatomy.module');
// Links: tied when missing; taken back when of the sync's own types, from an item it still wants, and no longer wanted.
const ref = (key: string) => id(key) ?? `{${key}}`;
const linkKey = (l: { type: string; from: string; to: string }) => `${l.type}|${l.from}|${l.to}`;
const wantedLinks = new Map(want.links.map((l) => [linkKey({ type: l.type, from: ref(l.from), to: ref(l.to) }), l] as const));
const haveLinks = new Set(have.links.map(linkKey));
const tie = [...wantedLinks].filter(([k]) => !haveLinks.has(k)).map(([, l]) => l);
const untie = have.links.filter((l) => MADE_LINKS.includes(l.type) && wanted.has(have.keyById.get(l.from) ?? '') && have.keyById.has(l.to) && !wantedLinks.has(linkKey(l)));
console.log(`${core.files.length + hosted.files.length} files (${have.bulk ? 'bulk read' : 'read item by item'}); wanted ${want.items.length} items, ${want.links.length} links; make ${create.length}, change ${update.length}, archive ${gone.length}; tie ${tie.length}, take back ${untie.length}`);

const refs = new Map(create.map((w, j) => [w.key, `r${j}`]));
const end = (key: string) => id(key) ?? refs.get(key)!;
const ops: Record<string, unknown>[] = [
  ...create.map((w) => ({ op: 'create', ref: refs.get(w.key), type: w.type, title: w.title, ...(w.body && { body: w.body }), props: { island: have.island, ...w.props } })),
  ...update.map((w) => ({ op: 'update', id: id(w.key), title: w.title, body: w.body, props: w.props })),
  ...gone.map(([, h]) => ({ op: 'archive', id: h.id })),
  ...tie.map((l) => ({ op: 'link', type: l.type, from: end(l.from), to: end(l.to), ...(l.props && { props: l.props }) })),
  ...untie.map((l) => ({ op: 'unlink', relation: l.id })),
];
const reason = `Pack anatomy: the island brought to ${core.commit.slice(0, 8)} and hosted ${hosted.commit.slice(0, 8)}`;
const authority = { of: 'agent', basis: `The code at ${REF}, read by packs/anatomy_sync's extractors (scripts/anatomy.ts).` };
if (DRY || !ops.length) console.log(DRY ? `would send ${ops.length} ops` : 'nothing to change');
else if (ops.length <= ONE_CHANGE) { await call('change', { ...(RUN && { run: RUN }), authority, reason, ops }); console.log(`sent ${ops.length} ops in one change`); }
else {
  // A first fill is past one change: items first, in parts, then the links between them, which need their ids.
  const made = new Map<string, string>();
  const items = ops.filter((o) => o.op !== 'link' && o.op !== 'unlink');
  for (let i = 0; i < items.length; i += 300) {
    const res = await call('change', { ...(RUN && { run: RUN }), authority, reason: `${reason} (items, part ${i / 300 + 1})`, ops: items.slice(i, i + 300) });
    for (const [r, eid] of Object.entries<string>(res.created ?? {})) made.set(r, eid);
  }
  const rest = ops.filter((o) => o.op === 'link' || o.op === 'unlink').map((o) => (o.op === 'link' ? { ...o, from: made.get(o.from as string) ?? o.from, to: made.get(o.to as string) ?? o.to } : o));
  for (let i = 0; i < rest.length; i += 500) await call('change', { ...(RUN && { run: RUN }), authority, reason: `${reason} (links, part ${i / 500 + 1})`, ops: rest.slice(i, i + 500) });
  console.log(`sent ${ops.length} ops in parts: a first fill`);
}
