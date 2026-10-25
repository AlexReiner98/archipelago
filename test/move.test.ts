// Moving a map between PGlite and a Postgres server by replaying its log (src/move.ts): the chains verify on both
// sides, the projections replayed are the source's row for row, and what is kept beside the log comes too. With
// PELAGO_TEST_DATABASE_URL the map goes from PGlite to the server and back; without it, between two PGlite folders.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { agent, all, fresh, human, make, replayed } from './map.ts';
import { openDb, type Database } from '../src/db.ts';
import { verify } from '../src/log.ts';
import { move } from '../src/move.ts';
import { Archipelago } from '../src/pelago.ts';
import { callTool } from '../src/tools.ts';
import { undo } from '../src/undo.ts';

const server = process.env.PELAGO_TEST_DATABASE_URL;

/** A map with something of everything the log holds: held, decided and moot changes, an undo, a merge, a forget, a session's heartbeat, an operational stream. */
async function aMap(l: Archipelago) {
  const me = (await make(l, [{ op: 'create', ref: 'me', type: 'person', title: 'Owner' }])).me;
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Move it' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Replay the log', owner: me, body: 'Entry by entry.' },
    { op: 'create', ref: 'u', type: 'work.task', title: 'Compare both sides' },
    { op: 'create', ref: 'q', type: 'work.decision', title: 'Where does it move?' },
    { op: 'create', ref: 'sam', type: 'person', title: 'Sam Quill' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
    { op: 'link', type: 'part_of', from: 'u', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'u', to: 't' },
    { op: 'link', type: 'waits_on', from: 'u', to: 'sam', props: { for: 'a review' } },
  ]);
  const asked = (await l.change(agent, { reason: 'Answer it', ops: [{ op: 'update', id: made.q, status: 'decided', props: { outcome: 'Postgres', rationale: 'Teams' } }] })) as { proposal: string };
  await l.decide(human, { proposal: asked.proposal, approve: true, note: 'Yes' });
  const no = (await l.change(agent, { reason: 'Rename', ops: [{ op: 'update', id: made.p, title: 'Elsewhere' }] })) as { proposal: string };
  await l.decide(human, { proposal: no.proposal, approve: false, note: 'Keep it' });
  await l.change(agent, { reason: 'Later', ops: [{ op: 'update', id: made.p, props: { hub_at: 4 } }] });
  const edit = (await l.change(human, { reason: 'Reshape', ops: [{ op: 'update', id: made.u, title: 'Compare' }, { op: 'archive', id: made.u }] })) as { changeset: string };
  await undo(l, human, { changeset: edit.changeset });
  const twin = (await make(l, [{ op: 'create', ref: 'x', type: 'work.task', title: 'Replay it' }, { op: 'link', type: 'part_of', from: 'x', to: made.p }])).x;
  await make(l, [{ op: 'merge', keep: made.t, drop: twin }]);
  // A forget rewrites an operational entry that names Sam (src/opseal.ts), after the one that follows it: they still go across in their order.
  await l.record('claims', 'human:test', [['+', made.sam, 'note', 'Reviews on Fridays']]);
  await l.record('claims', 'human:test', [['+', made.t, 'note', 'Mine now']]);
  await l.change(human, { reason: 'Sam asked to be forgotten', ops: [{ op: 'forget', id: made.sam }] });
  const run = (await callTool(l, agent, 'session_start', { task: made.t, title: 'Moving' })) as { run: string };
  await callTool(l, agent, 'session_update', { run: run.run, note: 'Halfway' });
  await l.record('settings', 'human:test', [['+', 'setting', 'theme', 'dark']]);
  return { ...made, run: run.run } as Record<string, string>;
}

/** A new PGlite map in a folder of its own, whatever driver the other tests run on. */
async function folder(): Promise<{ db: Database; done: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-move-'));
  const db = await openDb(join(dir, 'db'));
  return { db, done: async () => (await db.close(), rmSync(dir, { recursive: true, force: true })) };
}

/** The same map, both sides: every projection, the chains, and what a page reads of one item. */
async function same(a: Archipelago, b: Archipelago, id: string) {
  const [x, y] = [await replayed(a), await replayed(b)];
  assert.deepEqual(y.live, x.live, 'the projections are the source’s, row for row');
  assert.deepEqual(y.replay, y.live, 'and the target’s log replays into them again');
  for (const stream of ['facts', 'pending'] as const) {
    const [v, w] = [await verify(a.db, stream), await verify(b.db, stream)];
    assert.deepEqual(w.problems, []);
    assert.deepEqual([w.entries, w.head], [v.entries, v.head], `the ${stream} stream is the same chain`);
  }
  const [g, h] = [await a.get(id), await b.get(id)];
  assert.deepEqual([h.entity.title, h.entity.body, h.outgoing.length], [g.entity.title, g.entity.body, g.outgoing.length]);
  assert.deepEqual((await all(b)).map((e) => e.reason), (await all(a)).map((e) => e.reason), 'every reason opens there as here');
}

test('a map moves to an empty database by replaying its log, and back again', async () => {
  const l = await fresh();
  const made = await aMap(l);
  const mid = await folder();
  try {
    const there = await move(l.db, mid.db, l.registry);
    assert.ok(there.entries.facts > 10 && there.entries.pending === 3);
    assert.equal(there.projected.proposal, 3);
    assert.ok(there.rows.vault_key > 0 && there.rows.log_op > 0, 'the keys and the operational streams come along');
    const m = new Archipelago(mid.db, l.registry);
    await same(l, m, made.t);
    const kept = (await m.entity(made.run))!.props as Record<string, unknown>;
    assert.ok(kept.last_seen, 'a session’s heartbeat, kept beside the log, comes as it was');

    const back = new Archipelago(await openDb(), l.registry);
    const again = await move(mid.db, back.db, l.registry);
    assert.deepEqual(again.head, there.head);
    await same(l, back, made.t);
    // The map goes on where it left off: the next change follows the chain.
    await make(back, [{ op: 'update', id: made.t, status: 'done' }]);
    assert.deepEqual((await verify(back.db)).problems, []);
  } finally {
    await mid.done();
  }
});

test('from PGlite to a Postgres server and back', { skip: !server && 'PELAGO_TEST_DATABASE_URL is not set' }, async () => {
  const src = await folder();
  const out = await folder();
  try {
    const { registry } = await fresh();
    const l = new Archipelago(src.db, registry);
    const made = await aMap(l);
    const pg = new Archipelago(await openDb(), registry); // a new database on the server
    await move(l.db, pg.db, registry);
    await same(l, pg, made.t);
    const home = new Archipelago(out.db, registry);
    await move(pg.db, home.db, registry);
    await same(l, home, made.t);
  } finally {
    await src.done();
    await out.done();
  }
});

test('a move refuses a target that holds anything, a source whose chain is broken, and a replay that does not agree', async () => {
  const l = await fresh();
  await aMap(l);
  const full = await fresh();
  await make(full, [{ op: 'create', type: 'work.task', title: 'Already here' }]);
  await assert.rejects(move(l.db, full.db, l.registry), /not empty/);

  const broken = await fresh();
  await make(broken, [{ op: 'create', type: 'work.task', title: 'One' }]);
  // Forged as the next entry, as the chain's trigger asks (src/partitions.ts), with a hash its contents do not make.
  await broken.db.query(
    `insert into log_entry (stream, pos, id, at, head, prev, hash)
     select 'facts', pos + 1, 'c_forged', greatest(now(), at), '{}'::jsonb, hash, '\\x00' from log_entry where stream = 'facts' order by at desc, pos desc limit 1`,
  );
  const target = await openDb();
  await assert.rejects(move(broken.db, target, broken.registry), /does not verify/);
  assert.equal((await target.query<{ n: number }>(`select count(*)::int as n from log_entry`)).rows[0].n, 0, 'nothing was carried');

  // Replayed under other rules than the source's, the items come out otherwise, and the target keeps none of it.
  const otherwise = Object.assign(Object.create(Object.getPrototypeOf(l.registry)), l.registry, { isOpen: () => false });
  await assert.rejects(move(l.db, target, otherwise), /entity rows replayed are not the source's/);
  for (const t of ['log_entry', 'entity', 'vault_key', 'log_op']) assert.equal((await target.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0].n, 0, `${t} is empty`);
});

test('a map is moved from the command line, with its server’s key, and nothing is left of a move that failed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-move-cli-'));
  const key = randomBytes(32).toString('base64');
  const was = process.env.PELAGO_SECRETS_KEY;
  process.env.PELAGO_SECRETS_KEY = key; // sealed here as the server would seal it
  try {
    const { registry } = await fresh();
    const db = await openDb(join(dir, 'data'));
    const l = new Archipelago(db, registry);
    await make(l, [{ op: 'create', type: 'work.task', title: 'Moved from the command line', body: 'Sealed.' }]);
    await db.close();
    const cli = (args: string[], secrets = key) =>
      spawnSync(process.execPath, [join(import.meta.dirname, '..', 'src', 'cli.ts'), 'move', ...args], { encoding: 'utf8', env: { ...process.env, PELAGO_SECRETS_KEY: secrets, PELAGO_DATA: join(dir, 'data') } });
    const moved = cli([join(dir, 'data'), join(dir, 'moved')]);
    assert.equal(moved.status, 0, moved.stderr);
    assert.match(moved.stdout, /Moved: 1 change sets and 0 held changes, the same chain on both sides/);
    assert.match(cli([join(dir, 'data'), join(dir, 'moved')]).stderr, /not empty/, 'never over a map');
    const other = cli([join(dir, 'data'), join(dir, 'wrong')], randomBytes(32).toString('base64'));
    assert.match(other.stderr, /do not open with the sealing key here/);
    assert.ok(!existsSync(join(dir, 'wrong')), 'the folder made for it is gone again');
    assert.match(cli([join(dir, 'none'), join(dir, 'x')]).stderr, /There is no map in/);
  } finally {
    if (was === undefined) delete process.env.PELAGO_SECRETS_KEY;
    else process.env.PELAGO_SECRETS_KEY = was;
    rmSync(dir, { recursive: true, force: true });
  }
});
