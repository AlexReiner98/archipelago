// What a server pack counts on a public site's map (count.add, count.read, src/pack-counts.ts): held in memory,
// written down each minute in the stream the pack names, read back as what was added after a position; and the
// reader's tagged page load counted that way, end to end. site.visits reads the same, for one release.

import assert from 'node:assert/strict';
import { request } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { doneEvents } from '../src/activity.ts';
import { addCount, countsSince, dayOf, flushCounts, heldCounts, keepCounts } from '../src/pack-counts.ts';
import { runAct } from '../src/server-acts.ts';
import type { ServerPackFile } from '../src/server-packs.ts';
import { opEntries, type OpStream } from '../src/streams.ts';
import { fresh } from './map.ts';
import { serve } from './serve.ts';

const PAGES = [join(import.meta.dirname, 'fixtures', 'packs')];
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const VISITS = 'visits' as OpStream;

const packOf = (id: string, acts: string[], more: Record<string, unknown> = {}) => ({ id, version: '0.1.0', title: id, reach: { server: { acts, ...more } } }) as unknown as ServerPackFile;

/** Run with PELAGO_SITES naming the site, as the server is configured. */
async function withSites<T>(sites: string, run: () => Promise<T>): Promise<T> {
  const was = process.env.PELAGO_SITES;
  process.env.PELAGO_SITES = sites;
  try {
    return await run();
  } finally {
    if (was === undefined) delete process.env.PELAGO_SITES;
    else process.env.PELAGO_SITES = was;
  }
}

test('counts are written down each minute in their stream, adding to the day, and read after a position', async () => {
  const l = await fresh();
  const others = await fresh();
  const open = async (ws: string) => ({ pelago: ws === 'flushed' ? l : others });
  addCount('flushed', VISITS, 'x', '2026-11-04');
  addCount('flushed', VISITS, 'x', '2026-11-04');
  addCount('flushed', VISITS, 'y', '2026-11-04');
  await flushCounts(open);
  const first = await opEntries(l.db, VISITS);
  assert.equal(first.length, 1, 'a flush appends one entry');
  assert.equal(first[0].rule, 'visits', "kept by the rule core gives the reader's stream");
  assert.deepEqual(first[0].facts, [['+', 'key:x', '2026-11-04', 2], ['+', 'key:y', '2026-11-04', 1]]);
  assert.deepEqual(heldCounts('flushed', VISITS), [], 'what is written down leaves memory');
  await flushCounts(open);
  assert.equal((await opEntries(l.db, VISITS)).length, 1, 'nothing counted, nothing appended');

  addCount('flushed', VISITS, 'x', '2026-11-04');
  addCount('flushed', VISITS, 'x', '2026-11-05');
  await flushCounts(open);
  const all = await countsSince(l, VISITS);
  assert.deepEqual(all.counts, [{ key: 'x', day: '2026-11-04', n: 3 }, { key: 'y', day: '2026-11-04', n: 1 }, { key: 'x', day: '2026-11-05', n: 1 }], 'two flushes in a day sum');
  const later = await countsSince(l, VISITS, first[0].pos);
  assert.deepEqual(later.counts, [{ key: 'x', day: '2026-11-04', n: 1 }, { key: 'x', day: '2026-11-05', n: 1 }], 'after a position, only what was added since');
  assert.deepEqual(await countsSince(l, VISITS, all.pos), { counts: [], pos: all.pos });

  // What was written down before the move, as tag:, reads the same.
  await l.record(VISITS, 'system', [['+', 'tag:old', '2026-11-03', 4]]);
  assert.deepEqual((await countsSince(l, VISITS, all.pos)).counts, [{ key: 'old', day: '2026-11-03', n: 4 }]);

  // What has not been written down when the server stops is written down on the way.
  const pos = (await countsSince(l, VISITS)).pos;
  addCount('flushed', VISITS, 'z', '2026-11-05');
  await keepCounts(open, 3_600_000)();
  assert.deepEqual((await countsSince(l, VISITS, pos)).counts, [{ key: 'z', day: '2026-11-05', n: 1 }]);
});

test('a failed write keeps the counts for the next minute', async () => {
  addCount('fails', VISITS, 'x', '2026-11-04', 2);
  const was = console.error;
  console.error = () => {};
  try {
    await flushCounts(async () => { throw new Error('closed'); });
  } finally {
    console.error = was;
  }
  assert.deepEqual(heldCounts('fails', VISITS), [{ key: 'x', day: '2026-11-04', n: 2 }]);
});

test('a pack adds to its own counts on a site it is served, and reads its own or another’s; site.visits reads the site’s', async () => {
  const { workspaces } = await serve('off');
  await withSites('counts.example=default', async () => {
    const reader = packOf('reader', ['count.add'], { counts: 'visits', mounts: { site: 'site' } });
    const billing = packOf('billing', ['count.read', 'site.visits']);
    const packs = [reader, billing];
    const act = (pack: ServerPackFile, name: string, input: Record<string, unknown>) => runAct(workspaces, pack, name, input, undefined, packs) as Promise<{ counts: Record<string, unknown>[]; pos: number }>;
    await assert.rejects(act(billing, 'count.add', { site: 'counts.example', key: 'x' }), /did not declare the act "count.add"/);
    await assert.rejects(act(packOf('plain', ['count.add']), 'count.add', { site: 'counts.example', key: 'x' }), /names no stream for its counts/);
    await assert.rejects(act(reader, 'count.add', { site: 'elsewhere.example', key: 'x' }), /not a site this server serves/);
    await assert.rejects(act(reader, 'count.add', { site: 'counts.example', key: 'not a key' }), /key:/);
    await assert.rejects(act(billing, 'count.read', { site: 'counts.example', of: 'reader', after: -1 }), /after:/);

    assert.deepEqual(await act(billing, 'count.read', { site: 'counts.example', of: 'reader' }), { counts: [], pos: 0 });
    await act(reader, 'count.add', { site: 'Counts.Example', key: 'linkedin', n: 2 });
    await flushCounts((id) => workspaces.get(id));
    const first = await act(billing, 'count.read', { site: 'counts.example', of: 'reader' });
    assert.deepEqual(first.counts, [{ key: 'linkedin', day: dayOf(), n: 2 }]);
    assert.deepEqual(await act(billing, 'count.read', { site: 'counts.example' }), { counts: [], pos: 0 }, 'its own: it keeps none');
    assert.deepEqual(await act(billing, 'site.visits', { site: 'counts.example' }), { counts: [{ tag: 'linkedin', day: dayOf(), n: 2 }], pos: first.pos }, 'as before, for one release');
    assert.deepEqual((await act(billing, 'site.visits', { site: 'counts.example', after: first.pos })).counts, []);

    const { pelago } = await workspaces.get('default');
    const rows = (await doneEvents(pelago.db, { action: 'server.count.read' }, 1)) as unknown as { actor: string; detail: { rows: number } }[];
    assert.equal(rows[0].actor, 'pack:billing');
  });
});

/** A request as a browser at the site's domain sends it. */
function visit(base: string, path: string, headers: Record<string, string>, method = 'GET') {
  const { hostname, port } = new URL(base);
  return new Promise<number>((resolve, reject) => {
    request({ hostname, port, path, method, headers: { host: 'visits.test', 'user-agent': BROWSER, ...headers } }, (res) => res.resume().on('end', () => resolve(res.statusCode ?? 0))).on('error', reject).end();
  });
}

test('the reader counts a reader’s tagged page load on its site once; its data, a bot, a prefetch and a HEAD are not', async () => {
  await withSites('visits.test=default', async () => {
    const { call, base } = await serve('off', undefined, { 'visits.test': 'default' }, PAGES);
    const { home } = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'home', type: 'page', title: 'Welcome', visibility: 'shared', props: { path: 'home' }, body: 'The front page.' }] })).result.created;
    assert.equal((await call('/api/publish', undefined, { id: home })).status, 200);
    const count = (tag: string) => heldCounts('default', VISITS).find((r) => r.key === tag && r.day === dayOf())?.n ?? 0;

    for (let i = 0; i < 3; i++) assert.equal(await visit(base, '/?ref=x', {}), 200);
    assert.equal(count('x'), 3, 'each page load counts');
    assert.equal(await visit(base, '/data?ref=x', {}), 200);
    assert.equal(await visit(base, '/robots.txt?ref=x', {}), 200);
    assert.equal(await visit(base, '/home?ref=x', {}), 301);
    await visit(base, '/?ref=x', { 'user-agent': 'LinkedInBot/1.0' });
    await visit(base, '/?ref=x', { 'sec-purpose': 'prefetch' });
    await visit(base, '/?ref=x', {}, 'HEAD');
    assert.equal(count('x'), 3, 'nothing but a reader’s page load counts');
    await visit(base, '/', { referer: 'https://news.ycombinator.com/item?id=1' });
    assert.equal(count('ycombinator'), 1, 'an untagged page from another site counts under its name');
    await visit(base, '/', {});
    assert.deepEqual(heldCounts('default', VISITS).map((r) => r.key).sort(), ['x', 'ycombinator'], 'no tag, no count');
  });
});

test('with no site, counts are kept on a workspace that has a public view, and a /p/ visit there is counted on it', async () => {
  const { workspaces, call, base } = await serve('off', undefined, undefined, PAGES);
  const reader = packOf('reader', ['count.add'], { counts: 'visits', mounts: { public: 'page' } });
  const billing = packOf('billing', ['count.read']);
  const act = (pack: ServerPackFile, name: string, input: Record<string, unknown>) => runAct(workspaces, pack, name, input, undefined, [reader, billing]) as Promise<{ counts: Record<string, unknown>[]; pos: number }>;
  // Nothing public on it: nothing to visit, so no counts.
  await assert.rejects(act(reader, 'count.add', { workspace: 'default', key: 'x' }), /has no public view/);
  await assert.rejects(act(reader, 'count.add', { workspace: 'nowhere', key: 'x' }), /not a workspace this server holds/);
  await assert.rejects(act(billing, 'count.read', { workspace: 'default', of: 'reader' }), /has no public view/);

  const { page } = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'page', type: 'page', title: 'A map of mine', visibility: 'shared', body: 'Shared for anyone.' }] })).result.created;
  assert.equal((await call('/api/share_create', undefined, { id: page })).status, 200);
  const count = (tag: string) => heldCounts('default', VISITS).find((r) => r.key === tag && r.day === dayOf())?.n ?? 0;
  // The reader's own page load at /p/, on a server that names no site for the workspace.
  const { hostname, port } = new URL(base);
  const status = await new Promise<number>((resolve, reject) => {
    request({ hostname, port, path: `/p/default/${page}?ref=post1`, headers: { 'user-agent': BROWSER } }, (res) => res.resume().on('end', () => resolve(res.statusCode ?? 0))).on('error', reject).end();
  });
  assert.equal(status, 200);
  assert.equal(count('post1'), 1, 'the visit is counted on its own map');
  await act(reader, 'count.add', { workspace: 'default', key: 'post2', n: 2 });
  await flushCounts((id) => workspaces.get(id));
  // Read back by its workspace (what earlier tests left in memory for a workspace of this name is there too).
  const read = await act(billing, 'count.read', { workspace: 'default', of: 'reader' });
  assert.deepEqual(read.counts.filter((r) => String(r.key).startsWith('post')).map((r) => [r.key, r.n]).sort(), [['post1', 1], ['post2', 2]]);
});
