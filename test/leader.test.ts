import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { pgLeader, type Leader } from '../src/leader.ts';
import { Workspaces } from '../src/workspaces.ts';

const server = process.env.PELAGO_TEST_DATABASE_URL;

/** The next change of leading, or a failure after ten seconds rather than a run that never ends. */
const nextChange = (l: Leader) =>
  new Promise<boolean>((resolve, reject) => {
    const late = setTimeout(() => reject(new Error('leadership did not change within 10 s')), 10_000);
    l.onChange((on) => {
      clearTimeout(late);
      resolve(on);
    });
  });

test('only a leading server runs the clocks, and stops them when it loses the lead', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pelago-leader-'));
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: join(import.meta.dirname, '..', 'packs') });
  const ws = await workspaces.get('default');
  const calls: string[] = [];
  ws.automations.start = () => void calls.push('start');
  ws.automations.stop = () => void calls.push('stop');
  await workspaces.lead(true);
  assert.deepEqual(calls.filter((c) => c === 'start'), ['start'], 'the leader starts what runs on a clock');
  calls.length = 0;
  await workspaces.lead(false);
  assert.deepEqual(calls, ['stop'], 'a follower runs nothing on a clock');
  await workspaces.closeAll();
});

test('of two servers on one database, one leads, and the other takes over when it stops', { skip: !server && 'needs PELAGO_TEST_DATABASE_URL' }, async () => {
  const key = `pelago.leader.test.${process.pid}.${Date.now()}`;
  const a = await pgLeader(server!, { everyMs: 100, key });
  const b = await pgLeader(server!, { everyMs: 100, key });
  try {
    assert.equal(a.leading, true, 'the first to ask leads');
    assert.equal(b.leading, false, 'the second follows');
    const tookOver = nextChange(b);
    await a.stop();
    assert.equal(await tookOver, true, 'the follower leads once the leader is gone');
    assert.equal(b.leading, true);
  } finally {
    await a.stop();
    await b.stop();
  }
});

test('a leader whose connection is cut stops leading, and the follower takes over', { skip: !server && 'needs PELAGO_TEST_DATABASE_URL' }, async () => {
  const key = `pelago.leader.test.${process.pid}.${Date.now()}.cut`;
  const a = await pgLeader(server!, { everyMs: 100, key });
  const b = await pgLeader(server!, { everyMs: 100, key });
  const admin = new pg.Client({ connectionString: server });
  await admin.connect();
  try {
    const stepped = nextChange(a);
    const tookOver = nextChange(b);
    // The leader's connection is the one holding an advisory lock under its name.
    await admin.query(`select pg_terminate_backend(l.pid) from pg_locks l join pg_stat_activity s using (pid) where l.locktype = 'advisory' and l.granted and s.application_name = 'pelago-leader'`);
    assert.equal(await stepped, false, 'the old leader notices and stops');
    assert.equal(await tookOver, true, 'the follower leads');
  } finally {
    await admin.end();
    await a.stop();
    await b.stop();
  }
});
