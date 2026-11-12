// The reads the moved service packs still lacked (task e_szpyn5c2, packs/loader/kernel/packreads-service.ts): one link
// by id, the log's head, a pack's own memory, the island rules' verdict, what is public, a kept picture, a count stream
// and who corrected what after an agent. Each answers as the asker, and only to the server's own packs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerRead } from '../src/packreads.ts';
import { headPos } from '../src/tail.ts';
import { fresh, human, make } from './map.ts';

test('a service read is the server\'s own packs\', never a sandboxed pack\'s', async () => {
  const l = await fresh();
  await assert.rejects(answerRead(l, { log_head: true }), /Only the server's own packs read log_head/);
  await assert.rejects(answerRead(l, { link: 'r_whatever' }), /link/);
});

test('one link is read by its id, open only, and by no one with no login', async () => {
  const l = await fresh();
  const { a, b } = await make(l, [{ op: 'create', ref: 'a', type: 'task', title: 'A' }, { op: 'create', ref: 'b', type: 'task', title: 'B' }, { op: 'link', type: 'depends_on', from: 'a', to: 'b' }]);
  const [tie] = (await answerRead(l, { links: { from: [a] } })) as { id: string }[];
  const one = (await answerRead(l, { link: tie.id }, 'placement')) as { id: string; type: string; from_id: string; to_id: string };
  assert.deepEqual([one.id, one.type, one.from_id, one.to_id], [tie.id, 'depends_on', a, b]);
  assert.equal(await answerRead(l.forAnyone(), { link: tie.id }, 'placement'), null);
  await make(l, [{ op: 'unlink', relation: tie.id }]);
  assert.equal(await answerRead(l, { link: tie.id }, 'placement'), null, 'a link taken away is not read');
});

test('the log\'s head is where the fact stream stands', async () => {
  const l = await fresh();
  const before = (await answerRead(l, { log_head: true }, 'automation_triggers')) as number;
  assert.equal(before, await headPos(l.db));
  await make(l, [{ op: 'create', type: 'task', title: 'Moves it' }]);
  assert.ok(((await answerRead(l, { log_head: true }, 'automation_triggers')) as number) > before);
  await assert.rejects(answerRead(l.forAnyone(), { log_head: true }, 'automation_triggers'), /no login/);
});

test('a pack\'s memory is its own: read, written and cleared under its own key', async () => {
  const l = await fresh();
  assert.equal(await answerRead(l, { memory: { key: 'x:1' } }, 'automation_triggers'), null);
  assert.equal(await answerRead(l, { memory: { key: 'x:1', value: { pos: 3 } } }, 'automation_triggers'), true);
  assert.deepEqual(await answerRead(l, { memory: { key: 'x:1' } }, 'automation_triggers'), { pos: 3 });
  assert.equal(await answerRead(l, { memory: { key: 'x:1' } }, 'publish'), null, 'another pack does not read it');
  assert.deepEqual(await l.setting('due_on:x:1'), { pos: 3 }, 'kept under the prefix its manifest declares (kernel.memory), as the clock kept it');
  await answerRead(l, { memory: { key: 'x:1', value: 1 } }, 'publish');
  assert.equal(await l.setting('pack:publish:x:1'), 1, 'a pack that declares none: under its own key, apart from the kernel\'s settings');
  await answerRead(l, { memory: { key: 'x:1', value: null } }, 'automation_triggers');
  assert.equal(await answerRead(l, { memory: { key: 'x:1' } }, 'automation_triggers'), null);
  await assert.rejects(answerRead(l, { memory: { key: 'no spaces' } }, 'automation_triggers'), /memory.key/);
});

test('the island rules\' verdict names the local pack and what would be switched off', async () => {
  const l = await fresh();
  const { local, off } = (await answerRead(l, { islands_off: true }, 'placement')) as { local: string; off: [string, string][] };
  assert.equal(local, 'local');
  assert.ok(Array.isArray(off) && off.every((o) => typeof o[0] === 'string' && typeof o[1] === 'string'));
});

test('what is public, published and shared, and a kept picture', async () => {
  const l = await fresh();
  assert.deepEqual(await answerRead(l, { public_views: true }, 'publish'), []);
  assert.equal(await answerRead(l, { public_view_at: 'home' }, 'publish'), null);
  assert.deepEqual(await answerRead(l, { shared: {} }, 'publish'), []);
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Pictured' }]);
  assert.equal(await answerRead(l, { published_row: t }, 'publish'), null);
  assert.equal(await answerRead(l, { public_document: { id: t } }, 'publish'), null, 'a task is no public document');
  await assert.rejects(answerRead(l.forAnyone(), { shared: {} }, 'publish'), /no login/);
  assert.equal(await answerRead(l, { picture: t }, 'publish'), null);
  await l.db.query(`insert into picture (entity_id, content_type, bytes, size) values ($1, 'image/png', decode('AAEC', 'base64'), 3)`, [t]);
  assert.deepEqual(await answerRead(l, { picture: t }, 'publish'), { content_type: 'image/png', size: 3, data: 'AAEC' });
});

test('a count stream is read after a position, a kernel stream never', async () => {
  const l = await fresh();
  await l.record('visits' as never, 'system', [['+', 'key:home', '2026-11-11', 2]]);
  await l.record('visits' as never, 'system', [['+', 'key:home', '2026-11-11', 1]]);
  const all = (await answerRead(l, { counts: { stream: 'visits' } }, 'publish')) as { pos: number; facts: unknown[] }[];
  assert.equal(all.length, 2);
  assert.deepEqual(all[0].facts, [['+', 'key:home', '2026-11-11', 2]]);
  const after = (await answerRead(l, { counts: { stream: 'visits', after: all[0].pos } }, 'publish')) as { pos: number }[];
  assert.deepEqual(after.map((e) => e.pos), [all[1].pos]);
  for (const stream of ['sessions', 'access', 'pack:mail']) await assert.rejects(answerRead(l, { counts: { stream } }, 'publish'), /count stream/);
});

test('corrections: what a person said after an agent last did', async () => {
  const l = await fresh();
  // Made by anyone not a person (here the system, as an applied agent's change would be).
  await l.apply('system', { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Not by a person' }] });
  const [{ id: t }] = (await answerRead(l, { items: { type: 'task' } })) as { id: string }[];
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: t, title: 'Fixed by a person' }] });
  const rows = (await answerRead(l, { corrections: [t] }, 'sessions')) as { id: string; field: string; actor: string; added: boolean }[];
  assert.ok(rows.some((r) => r.id === t && r.field === 'title' && r.actor.startsWith('human:') && !r.added));
  const { p } = await make(l, [{ op: 'create', ref: 'p', type: 'task', title: 'A person\'s own' }]);
  assert.ok(((await answerRead(l, { corrections: [p] }, 'sessions')) as { added: boolean }[]).every((r) => r.added), 'made by a person, it counts whole');
});
