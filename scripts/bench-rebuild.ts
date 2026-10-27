// Rebuilding the projections at scale (docs/log.md, section 7), on the map scripts/gen-map.ts makes:
//   node --max-old-space-size=8192 scripts/bench-rebuild.ts [--events 1000000] [--seed 1] [--more 2000]
// The generator writes the map's rows, not its log, so this writes the log for them first: one change set per item
// (its fields as facts) and one per link, appended through the log's own append, sealed with keys made in the vault.
// Then it times a walk of the whole log into a snapshot, a rebuild from the start swapped in, a rebuild from that
// snapshot after --more further change sets, an as-of read halfway, and a backup (snapshot and log) restored into an
// empty map. Everything is in a temporary folder, deleted at the end. docs/bench.md says more.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { itemFacts, linkFacts } from '../src/facts.ts';
import { append, headOf } from '../src/log.ts';
import { Registry } from '../src/packs.ts';
import { asOf, rebuildProjections, snapshotNow } from '../src/rebuild.ts';
import { dump, restore } from '../src/backup.ts';
import { dumpVault } from '../src/vault.ts';
import { KEPT_FIELDS } from '../src/operational.ts';

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : dflt);
const EVENTS = Number(opt('events', '1000000'));
const SEED = opt('seed', '1');
const MORE = Number(opt('more', '2000'));
const ROOT = join(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'pelago-rebuild-'));
const results: Record<string, unknown> = { events: EVENTS, seed: Number(SEED), at: new Date().toISOString() };
const say = (line: string) => process.stderr.write(`${line}\n`);
const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  const t = performance.now();
  const out = await fn();
  results[`${name}_ms`] = Math.round(performance.now() - t);
  say(`${name}: ${((performance.now() - t) / 1000).toFixed(1)} s`);
  return out;
};

try {
  say(`generating a map of ${EVENTS.toLocaleString()} events`);
  const gen = spawnSync(process.execPath, ['--max-old-space-size=8192', join(ROOT, 'scripts', 'gen-map.ts'), join(dir, 'data'), '--events', String(EVENTS), '--seed', SEED], { stdio: ['ignore', 'pipe', 'inherit'] });
  if (gen.status !== 0) throw new Error('the generator failed');
  results.map = JSON.parse(gen.stdout.toString().trim().split('\n').at(-1)!);

  const db = await openDb(join(dir, 'data'));
  const reg = new Registry(join(ROOT, 'packs'));
  const ws = 'default';
  const actor = { id: 'human:owner' };
  const rule = { outcome: 'apply', spared: [] };
  const appendAll = async (heads: { facts: ReturnType<typeof itemFacts> }[]) => {
    for (let i = 0; i < heads.length; i += 1000) {
      await db.transaction(async (tx) => {
        for (const h of heads.slice(i, i + 1000)) await append(tx, ws, 'facts', { id: `c_${Math.random().toString(36).slice(2, 10)}`, actor, authority: null, rule, reason: 'Generated', source: null, action: null, undoes: null, keys: [] }, h.facts);
      });
    }
  };

  // The log of the generated rows: each item, then each link, as the write path would have said them.
  await timed('write_log', async () => {
    const items = (await db.query<Record<string, unknown>>(`select * from entity order by created_at`)).rows;
    await appendAll(items.map((r) => ({ facts: itemFacts({ ...r, props: Object.fromEntries(Object.entries(r.props as object).filter(([k]) => !KEPT_FIELDS.includes(k))) }) })));
    const links = (await db.query<Record<string, unknown>>(`select * from relation where type <> 'holds' order by valid_from`)).rows;
    await appendAll(links.map((r) => ({ facts: [...linkFacts(r), ...(r.valid_to ? [['-', r.id, 'link'] as ['-', string, string]] : [])] })));
    results.entries = (await headOf(db)).pos;
    results.items = items.length;
    results.links = links.length;
  });
  const rebuild = (name: string, fn: () => ReturnType<typeof rebuildProjections>) =>
    timed(name, fn).then((r) => (results[name] = { from: r.from, entries: r.entries, chunks: r.chunks, snapshot_ms: r.snapshot_ms, swap_ms: r.swap_ms, swapped: r.swapped }));

  await rebuild('snapshot_from_start', () => snapshotNow(db, reg, ws));
  await rebuild('rebuild_from_start', () => rebuildProjections(db, reg, ws, { fromStart: true }));
  const anItem = (await db.query<{ id: string }>(`select id from entity where type = 'task' limit 1`)).rows[0].id;
  await appendAll(Array.from({ length: MORE }, (_, i) => ({ facts: [['+', anItem, 'body', `Step ${i}`]] as ReturnType<typeof itemFacts> })));
  await rebuild('rebuild_from_snapshot', () => rebuildProjections(db, reg, ws));
  await timed('as_of_halfway', () => asOf(db, reg, ws, Math.floor((results.entries as number) / 2)));
  await timed('as_of_after_snapshot', () => asOf(db, reg, ws, (results.entries as number) + Math.floor(MORE / 2)));

  const file = { ...(await timed('backup_dump', () => dump(db, { id: ws, name: 'Bench' }))), vault: await dumpVault(db) };
  results.backup_mb = Math.round(Buffer.byteLength(JSON.stringify(file)) / 1e6);
  await db.close();
  const there = await openDb(join(dir, 'restored'));
  await timed('backup_restore', () => restore(there, file));
  await there.close();
  console.log(JSON.stringify(results, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
