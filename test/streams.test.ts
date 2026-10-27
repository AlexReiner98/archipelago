// The compacted streams (docs/log.md, section 4): each operational write appended at once to its stream with the
// light header, every closed day sealed by a system entry in the fact stream, compaction dropping what the packs'
// retention rules no longer keep, and the fact stream's chain verifying after it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agent, fresh, human, make } from './map.ts';
import { entries, verify } from '../src/log.ts';
import { compact, opEntries, readOps, record, seal, segments, verifySegments, type OpStream } from '../src/streams.ts';
import { checkRetention, duration, kept, type OpEntry, type Retention } from '../src/retention.ts';
import { checkRules } from '../src/rules.ts';
import { createToken, verifyToken } from '../src/auth.ts';
import { putPicture } from '../src/pictures.ts';
import { callTool } from '../src/tools.ts';
import type { Archipelago } from '../src/pelago.ts';

const DAY = 86_400_000;
const facts = async (l: Archipelago, stream: OpStream) => (await readOps(l.db, stream)).flatMap((e) => e.facts.map((f) => [e.rule, ...f]));

test('each operational write lands in its stream, at once, with the light header', async () => {
  const l = await fresh();
  const { run, auto, res, task, n, conn, note } = await make(l, [
    { op: 'create', ref: 'run', type: 'run', title: 'A run' },
    { op: 'create', ref: 'auto', type: 'automation', title: 'Nightly', props: { trigger: 'every', every_minutes: 60, action: 'notify' } },
    { op: 'create', ref: 'res', type: 'resource', title: 'The lane' },
    { op: 'create', ref: 'task', type: 'task', title: 'Hold it' },
    { op: 'create', ref: 'n', type: 'notification', title: 'Look' },
    { op: 'create', ref: 'conn', type: 'connection', title: 'Nowhere', props: { url: 'http://127.0.0.1:1/' } },
    { op: 'create', ref: 'note', type: 'note', title: 'Drawn' },
  ]);
  await l.operational(run, { add: { tokens_used: 40 }, props: { story: [{ n: 1, said: 'began' }], last_seen: 'now' } });
  await l.operational(run, { add: { tokens_used: 2 } });
  await l.operational(auto, { props: { last_fired: '2026-10-24T00:00:00Z', last_result: 'ok' } }, { actor: 'agent:pelago', action: 'automation.fire' });
  await l.operational(n, { reach: { private_to: null, visibility: 'shared' } });
  await l.claim(agent, { resource: res, holder: task, reason: 'mine' });
  await l.release(agent, { resource: res, reason: 'done' });
  await l.checkConnections(human);
  await l.setSecret('model_key', 'sk-test');
  await callTool(l, { ...human, admin: true }, 'workspace_set', { default_visibility: 'shared' });
  await putPicture(l, human, { result: note, data: Buffer.from('png').toString('base64'), content_type: 'image/png' });
  const token = (await createToken(l.db, 'default', { kind: 'agent', name: 'bot' })).token;
  await verifyToken(l.db, token);
  await verifyToken(l.db, token); // used again within the hour: not again in the stream

  const sessions = await facts(l, 'sessions');
  assert.deepEqual(sessions, [['sessions', '+', run, 'story', [{ n: 1, said: 'began' }]], ['sessions', '+', run, 'tokens_used', 40], ['sessions', '+', run, 'tokens_used', 42]], 'the value it came to, not the increment; the heartbeat is in no stream');
  assert.deepEqual(await facts(l, 'automations'), [['automations', '+', auto, 'last_fired', '2026-10-24T00:00:00Z'], ['automations', '+', auto, 'last_result', 'ok']]);
  assert.deepEqual(await facts(l, 'notifications'), [['notifications', '-', n, 'private_to'], ['notifications', '+', n, 'visibility', 'shared']]);
  const claims = await facts(l, 'claims');
  assert.equal(claims[0][3], 'link');
  assert.deepEqual((claims[0][4] as string[]).slice(1), [task, res]);
  assert.deepEqual(claims.at(-1), ['claims', '-', claims[0][2], 'link']);
  const obs = await facts(l, 'observations');
  assert.deepEqual(obs[0], ['observations', '+', conn, 'status', 'unavailable']);
  assert.equal(obs[1][0], 'pictures', 'a picture is kept by its own rule');
  assert.match((obs[1][4] as { $blob: string }).$blob, /^[0-9a-f]{64}$/);
  const settings = await facts(l, 'settings');
  assert.deepEqual(settings, [['settings', '+', 'secret', 'model_key', true], ['settings', '+', 'setting', 'default_visibility', 'shared']], 'a secret by its name only');
  assert.equal((await facts(l, 'access')).length, 1, 'a token is used at most once an hour in the stream');

  const [first] = await opEntries(l.db, 'automations');
  assert.deepEqual(Object.keys(first).sort(), ['actor', 'at', 'facts', 'pos', 'rule', 'stream', 'v', 'ws']);
  assert.deepEqual([first.v, first.ws, first.actor], [1, 'default', { id: 'agent:pelago' }]);
  assert.deepEqual((await verify(l.db)).problems, [], 'nothing operational in the fact stream breaks its chain');
});

test('a pack keeps its own stream, by the pack rule', async () => {
  const l = await fresh();
  const [e] = await l.record('pack:github', 'agent:github', [['+', 'installation', 'id', 7]]);
  assert.deepEqual([e.stream, e.rule], ['pack:github', 'pack']);
});

test('the log refuses to change or drop an operational entry, but to compaction', async () => {
  const l = await fresh();
  await l.record('settings', 'human:test', [['+', 'setting', 'x', 1]]);
  await assert.rejects(l.db.query(`delete from log_op`), /append-only/);
  await assert.rejects(l.db.query(`update log_op set facts = '[]'`), /append-only/);
  await assert.rejects(
    l.db.transaction(async (tx) => {
      await tx.query(`set local role pelago_compactor`);
      await tx.query(`update log_op set facts = '[]'`);
    }),
    /append-only|permission/,
    'compaction drops an entry whole, never rewrites one',
  );
});

/** An entry as if appended `daysAgo` days before `now`. */
async function past(l: Archipelago, stream: OpStream, now: Date, daysAgo: number, rule: string, fs: OpEntry['facts']) {
  const { rows } = await l.db.query<{ pos: number }>(`select coalesce(max(pos), 0)::int + 1 as pos from log_op where stream = $1`, [stream]);
  await l.db.query(`insert into log_op (stream, pos, at, head, facts) values ($1, $2, $3, $4::jsonb, $5::jsonb)`, [
    stream, rows[0].pos, new Date(now.getTime() - daysAgo * DAY).toISOString(), JSON.stringify({ v: 1, ws: 'default', actor: { id: 'system' }, rule }), JSON.stringify(fs),
  ]);
}

test('a closed day is sealed in the fact stream and verifies', async () => {
  const l = await fresh();
  const now = new Date();
  await past(l, 'settings', now, 2, 'settings', [['+', 'setting', 'a', 1]]);
  await past(l, 'settings', now, 2, 'settings', [['+', 'setting', 'a', 2]]);
  await past(l, 'settings', now, 1, 'settings', [['+', 'setting', 'a', 3]]);
  await l.record('settings', 'human:test', [['+', 'setting', 'a', 4]]); // today: not yet closed
  const sealed = await seal(l.db, 'default', now);
  assert.equal(sealed.length, 2, 'one segment per day');
  assert.deepEqual(sealed.map((s) => [s.from, s.to, s.entries]), [[1, 2, 2], [3, 3, 1]]);
  assert.equal((await seal(l.db, 'default', now)).length, 0, 'a day is sealed once');
  // Read opened: a change set's reason is sealed in the log (src/seal.ts).
  const rows = (await entries(l.db)).flatMap((e) => e.facts.filter((f) => f[2] === 'segment').map((f) => ({ reason: e.reason, id: f[1] })));
  assert.deepEqual(rows.map((r) => r.reason), ['Day sealed', 'Day sealed']);
  assert.match(rows[0].id, /^seg_settings_\d{8}$/);
  assert.deepEqual(await verifySegments(l.db), { segments: 2, problems: [] });
  assert.deepEqual((await verify(l.db)).problems, []);
  // An entry changed behind the log's back no longer hashes to its seal.
  await l.db.query(`alter table log_op disable trigger log_op_append_only`);
  await l.db.query(`update log_op set facts = '[["+","setting","a",9]]' where pos = 1`);
  await l.db.query(`alter table log_op enable trigger log_op_append_only`);
  assert.match((await verifySegments(l.db)).problems.join(), /do not hash/);
});

const at = (now: Date, daysAgo: number, hours = 0) => new Date(now.getTime() - daysAgo * DAY - hours * 3_600_000).toISOString();
const NOW = new Date('2026-10-24T12:00:00Z');

test('keep latest: the newest value of each field stays, the rest goes', () => {
  const rules: Retention[] = [{ id: 'r', keep: { latest: true } }];
  const es: OpEntry[] = [
    { pos: 1, at: at(NOW, 9), rule: 'r', facts: [['+', 'x', 'a', 1]] },
    { pos: 2, at: at(NOW, 5), rule: 'r', facts: [['+', 'x', 'a', 2], ['+', 'x', 'b', 1]] },
    { pos: 3, at: at(NOW, 1), rule: 'r', facts: [['+', 'x', 'a', 3]] },
  ];
  assert.deepEqual([...kept(es, rules, NOW)].sort(), [2, 3], 'the second still holds b');
});

test('keep history: older values stay this long', () => {
  const rules: Retention[] = [{ id: 'r', keep: { latest: true, history: 'P7D' } }];
  const es: OpEntry[] = [1, 6, 8, 20].map((d, i) => ({ pos: 4 - i, at: at(NOW, d), rule: 'r', facts: [['+', 'x', 'a', d]] }));
  assert.deepEqual([...kept(es, rules, NOW)].sort(), [3, 4]);
});

test('keep thin: one an hour after a day, one a day after a month', () => {
  const rules: Retention[] = [{ id: 'r', keep: { latest: true, thin: [['P1D', 'PT1H'], ['P30D', 'P1D']] } }];
  const es: OpEntry[] = [];
  const add = (iso: string) => es.push({ pos: es.length + 1, at: iso, rule: 'r', facts: [['+', 'c', 'status', es.length]] });
  // Each hour of the day before, four readings a quarter-hour apart; and the same for one hour forty days ago.
  for (let q = 0; q < 4; q++) add(new Date(Date.parse('2026-10-22T10:00:00Z') + q * 900_000).toISOString());
  for (let q = 0; q < 4; q++) add(new Date(Date.parse('2026-09-14T10:00:00Z') + q * 900_000).toISOString());
  for (let q = 0; q < 4; q++) add(new Date(Date.parse('2026-09-14T16:00:00Z') + q * 900_000).toISOString());
  add(at(NOW, 0, 2)); // a reading of two hours ago: younger than every tier
  add(at(NOW, 0, 1));
  es.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).forEach((e, i) => (e.pos = i + 1));
  const k = kept(es, rules, NOW);
  assert.deepEqual([...k].sort((a, b) => a - b), [8, 12, 13, 14], 'one for the whole day forty days ago; the newest of the hour two days ago; the last day whole');
});

test('keep closed and open: a record goes whole once it has ended long enough, or never ended for too long', () => {
  const rules: Retention[] = [{ id: 'claims', keep: { latest: true, history: 'P30D', closed: 'P90D' } }, { id: 'n', keep: { latest: true, closed: 'P30D', open: 'P90D' } }];
  const es: OpEntry[] = [
    { pos: 1, at: at(NOW, 200), rule: 'claims', facts: [['+', 'r_old', 'link', ['holds', 'a', 'b']]] },
    { pos: 2, at: at(NOW, 100), rule: 'claims', facts: [['-', 'r_old', 'link']] },
    { pos: 3, at: at(NOW, 60), rule: 'claims', facts: [['+', 'r_new', 'link', ['holds', 'a', 'b']]] },
    { pos: 4, at: at(NOW, 50), rule: 'claims', facts: [['-', 'r_new', 'link']] },
    { pos: 5, at: at(NOW, 40), rule: 'n', facts: [['+', 'n_read', 'visibility', 'shared']] },
    { pos: 6, at: at(NOW, 100), rule: 'n', facts: [['+', 'n_unread', 'visibility', 'shared']] },
    { pos: 7, at: at(NOW, 80), rule: 'n', facts: [['+', 'n_waiting', 'visibility', 'shared']] },
  ];
  const read = new Date(NOW.getTime() - 35 * DAY);
  assert.deepEqual([...kept(es, rules, NOW, (id) => (id === 'n_read' ? read : undefined))].sort(), [4, 7], 'released 100 days ago goes whole; released 50 days ago keeps its latest; read 35 days ago goes; unread 100 days goes, 80 stays');
});

test('a retention rule is checked like the others', () => {
  assert.equal(duration('P1DT2H'), 26 * 3_600_000);
  assert.equal(duration('P'), undefined);
  assert.deepEqual(checkRetention({ id: 'x', stream: 'sessions', keep: { latest: true, history: 'P14D' } }, 'rule x'), []);
  const problems = checkRules([
    { id: 'a', stream: 'nowhere', keep: { latest: true } },
    { id: 'b', stream: 'sessions', keep: { history: 'two weeks' } as never },
    { id: 'c', stream: 'sessions', keep: { thin: [['P30D', 'P1D'], ['P1D', 'PT1H']] } },
    { id: 'd', stream: 'sessions', keep: { latest: true }, then: 'hold' },
    { id: 'e', keep: { latest: true } },
    { id: 'f', stream: 'observations', keep: { forever: true, latest: true } },
  ], { types: new Map() });
  assert.deepEqual(problems.map((p) => p.split(':')[0]), ['rule a', 'rule b', 'rule c', 'rule d', 'rule e', 'rule f']);
});

test("compaction drops what the rules no longer keep, and the fact stream's chain still verifies", async () => {
  const l = await fresh();
  const now = new Date();
  for (const d of [20, 10, 3]) await past(l, 'automations', now, d, 'automations', [['+', 'auto', 'last_fired', d]]);
  for (const d of [20, 3]) await past(l, 'settings', now, d, 'settings', [['+', 'setting', 'theme', d]]);
  await seal(l.db, 'default', now);
  const before = (await segments(l.db, 'automations')).map((s) => s.id);
  assert.equal(before.length, 3);

  const { segments: made, dropped } = await compact(l.db, 'default', l.registry.rules, now);
  assert.equal(dropped, 2, 'the two older firings go (seven days of history, then the latest); the settings keep a year');
  assert.deepEqual((await opEntries(l.db, 'automations')).map((e) => e.facts[0][3]), [3]);
  assert.equal(made.length, 1, 'the two neighbouring days that lost entries become one segment');
  assert.deepEqual(made[0].replaces, before.slice(0, 2));
  assert.deepEqual(made[0].rules, ['automations']);
  assert.equal(made[0].entries, 0);
  assert.deepEqual((await segments(l.db, 'automations')).map((s) => s.id), [made[0].id, before[2]]);
  assert.deepEqual(await verifySegments(l.db), { segments: 4, problems: [] });
  assert.deepEqual((await verify(l.db)).problems, [], 'the chain verifies after compaction');
  assert.deepEqual((await compact(l.db, 'default', l.registry.rules, now)).dropped, 0, 'nothing more to drop');
});

test('what is not sealed is not compacted', async () => {
  const l = await fresh();
  const now = new Date();
  for (const d of [20, 10]) await past(l, 'automations', now, d, 'automations', [['+', 'auto', 'last_fired', d]]);
  assert.equal((await compact(l.db, 'default', l.registry.rules, now)).dropped, 0);
  assert.equal((await opEntries(l.db, 'automations')).length, 2);
});

test('the packs declare a rule for every stream', async () => {
  const l = await fresh();
  const retention = l.registry.rules.filter((r) => r.stream);
  for (const s of ['sessions', 'claims', 'notifications', 'automations', 'settings', 'access', 'observations', 'places', 'pack:*']) assert.ok(retention.some((r) => r.stream === s), s);
  const [e] = await record(l.db, 'default', 'observations', 'system', [['+', 'c', 'status', 'up']], { rules: l.registry.rules });
  assert.equal(e.rule, 'observations');
});
