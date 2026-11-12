// Keeps the Pack anatomy island true to the packs: reads every pack.json and bundle.json at a git ref (origin/main by
// default) of this repository and of the hosted one (archipelago-hosted beside the main checkout, or --hosted <folder>);
// works out what the island should hold (scripts/anatomy-model.ts); reads what it holds; and sends the difference as
// changes: new items and links, items whose title, note or fields moved, and what no manifest declares any more
// archived or unlinked. Run it after a push, from any worktree (git fetch both repositories first):
//
//   node scripts/anatomy.ts [--dry] [--ref origin/main] [--hosted <folder>] [--run <run id>]
//
// It acts on the map PELAGO_URL names with PELAGO_AGENT_TOKEN (never printed), on the island that speaks the anatomy
// pack. What a person added there (principles, their modules) is left alone: only the model's own kinds are archived,
// only its own link types between its own items unlinked, and a module is never archived.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { keyOf, MADE_LINKS, model, type Bundle, type PackFile, type Want, type WantLink } from './anatomy-model.ts';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const DRY = process.argv.includes('--dry');
const REF = arg('ref') ?? 'origin/main';
const RUN = arg('run') ?? process.env.PELAGO_RUN;
const git = (repo: string, ...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const CORE = resolve(import.meta.dirname, '..');
// The hosted repository: --hosted, else archipelago-hosted beside the main checkout (a worktree's main checkout too).
const beside = resolve(git(CORE, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim(), '..', '..', 'archipelago-hosted');
const HOSTED = arg('hosted') ? resolve(arg('hosted')!) : existsSync(beside) ? beside : undefined;
if (arg('hosted') && !existsSync(HOSTED!)) throw new Error(`No hosted repository at ${HOSTED}: give --hosted the folder it is in, or leave it out to use ${beside}.`);
if (!HOSTED) throw new Error(`No hosted repository at ${beside}: give --hosted its folder. Without it every hosted pack on the island would be archived.`);
const repos: [string, PackFile['home']][] = [[CORE, 'open_core'], ...(HOSTED ? [[HOSTED, 'hosted'] as [string, PackFile['home']]] : [])];
function readPacks() {
  const packs: PackFile[] = [], bundles: Bundle[] = [];
  const roots = JSON.parse(git(repos[0][0], 'show', `${REF}:packs/roots.json`));
  const rootIds = new Set<string>(roots.roots.map((r: { id: string }) => r.id));
  for (const [repo, home] of repos) {
    for (const f of git(repo, 'ls-tree', '--name-only', '-r', REF).split('\n').filter((x) => /^(packs|workspace-packs)\/[^/]+\/(pack|bundle)\.json$/.test(x))) {
      const m = JSON.parse(git(repo, 'show', `${REF}:${f}`));
      if (f.endsWith('bundle.json')) bundles.push(m);
      else packs.push({ m, home, path: f.replace(/\/pack\.json$/, ''), root: rootIds.has(m.id) });
    }
  }
  return { packs, bundles, calls: (roots.calls ?? {}) as Record<string, string[]> };
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

interface Have { id: string; type: string; title: string; body: string; props: Record<string, unknown> }
/** What the island holds now: its items with their fields, keyed as the model keys them, and the links among them. */
async function readIsland() {
  const islands = (await query('search', { type: 'island', q: 'anatomy', full: true })) as Have[];
  const island = islands.find((i) => i.props?.pack === 'anatomy');
  if (!island) throw new Error('No island speaks the anatomy pack here: add the pack and make its island first.');
  const flat = await query('flat', { filter: { find: [`island ${island.id}`] }, limit: 2000 });
  if (flat.items.length >= 2000) throw new Error('The island holds 2000 items or more, past what one query answers: read it in parts.');
  // The query gives each item's note (cut when long), search its fields (200 of a type at most), get the rest whole.
  const notes = new Map<string, string>(flat.items.map((i: Have) => [i.id, i.body ?? '']));
  const items = new Map<string, Have>();
  for (const type of new Set<string>(flat.items.map((i: Have) => i.type))) for (const i of (await query('search', { type, limit: 200, full: true })) as Have[]) if (notes.has(i.id)) items.set(i.id, { ...i, body: notes.get(i.id)! });
  for (const i of flat.items as Have[]) if (!items.has(i.id) && i.type.startsWith('anatomy.')) items.set(i.id, (await query('get', { id: i.id, full: true })).entity);
  const links = flat.links as { id: string; type: string; from: string; to: string }[];
  const packOf = new Map<string, string>(); // item id -> the pack id it is part of
  for (const l of links) if (l.type === 'part_of' && items.get(l.to)?.type === 'anatomy.pack') packOf.set(l.from, String(items.get(l.to)!.props.pack_id));
  const byKey = new Map<string, Have>(), keyById = new Map<string, string>();
  for (const i of items.values()) { const k = i.props?.island === island.id ? keyOf(i.type, i.props, packOf.get(i.id)) : undefined; if (k && !byKey.has(k)) { byKey.set(k, i); keyById.set(i.id, k); } }
  return { island: island.id, byKey, keyById, links };
}

/** A note the query cut ends in an ellipsis: it is the same when the whole one starts with what was kept. */
const sameNote = (w: string, h: string) => w === h || (h.endsWith('…') && w.startsWith(h.slice(0, -1).trimEnd()));
const same = (w: Want, h: Have) => w.title === h.title && sameNote(w.body || '', h.body || '') &&Object.entries(w.props).every(([k, v]) => h.props?.[k] === v);

async function send(reason: string, ops: Record<string, unknown>[], per = 150, refs?: (res: any, chunk: Record<string, unknown>[]) => void) {
  for (let i = 0; i < ops.length; i += per) {
    const chunk = ops.slice(i, i + per);
    if (DRY) { console.log(`would send ${chunk.length}: ${reason}`); continue; }
    const res = await call('change', { ...(RUN && { run: RUN }), authority: { of: 'agent', basis: `The pack manifests at ${REF}: scripts/anatomy.ts.` }, reason, ops: chunk });
    refs?.(res, chunk);
    console.log(`${reason}: ${Math.min(i + per, ops.length)} / ${ops.length}`);
  }
}

const { packs, bundles, calls } = readPacks();
const want = model(packs, bundles, calls);
const have = await readIsland();
const id = (key: string) => have.byKey.get(key)?.id;

// Items: make what is missing, change what moved, archive what no manifest declares (never a module or a principle).
const wanted = new Set(want.items.map((w) => w.key));
const create = want.items.filter((w) => !id(w.key));
const update = want.items.filter((w) => id(w.key) && !same(w, have.byKey.get(w.key)!));
const gone = [...have.byKey].filter(([k, h]) => !wanted.has(k) && h.type !== 'anatomy.module');
console.log(`${packs.length} packs; ${want.items.length} items, ${want.links.length} links wanted; to make ${create.length}, change ${update.length}, archive ${gone.length}`);
await send('Pack anatomy: what the manifests declare that the island lacks', create.map((w, j) => ({ op: 'create', ref: `r${j}`, type: w.type, title: w.title, ...(w.body && { body: w.body }), props: { island: have.island, ...w.props } })), 150, (res, chunk) => {
  for (const op of chunk) { const w = create[Number(String(op.ref).slice(1))]; have.byKey.set(w.key, { id: res.created[op.ref as string], type: w.type, title: w.title, body: w.body, props: w.props }); }
});
await send('Pack anatomy: what changed in the manifests', update.map((w) => ({ op: 'update', id: id(w.key), title: w.title, body: w.body, props: w.props })));
await send('Pack anatomy: what no manifest declares any more', gone.map(([, h]) => ({ op: 'archive', id: h.id })));

// Links: tie what is missing; take back a link of the model's own types, from an item it still wants, that it no longer
// wants (a module or principle a person added keeps its links).
const linkKey = (l: { type: string; from: string; to: string }) => `${l.type}|${l.from}|${l.to}`;
const wantedLinks = new Map(want.links.flatMap((l: WantLink) => (id(l.from) && id(l.to) ? [[linkKey({ type: l.type, from: id(l.from)!, to: id(l.to)! }), l] as const] : [])));
const haveLinks = new Set(have.links.map(linkKey));
const tie = [...wantedLinks].filter(([k]) => !haveLinks.has(k)).map(([, l]) => ({ op: 'link', type: l.type, from: id(l.from), to: id(l.to), ...(l.props && { props: l.props }) }));
const untie = have.links.filter((l) => MADE_LINKS.includes(l.type) && wanted.has(have.keyById.get(l.from) ?? '') && have.keyById.has(l.to) && !wantedLinks.has(linkKey(l))).map((l) => ({ op: 'unlink', relation: l.id }));
console.log(`links: to tie ${tie.length}, take back ${untie.length}`);
await send('Pack anatomy: ties the manifests declare', tie, 200);
await send('Pack anatomy: ties no manifest declares any more', untie, 200);
