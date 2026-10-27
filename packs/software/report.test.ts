// The software pack's test_report, tested without a database: a few tests and results stand where the kernel
// answers the handler's reads.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';

const items = [
  { id: 'e_sun', type: 'test', title: 'Sun against NOAA', props: { entrypoint: 'Sun.MatchesNoaa' } },
  { id: 'e_pole', type: 'test', title: 'Pole stays put', props: {} },
  { id: 'e_old', type: 'test_result', title: '1.0.0: Sun against NOAA', props: { build: '1.0.0' } },
  { id: 'e_q', type: 'proof', title: 'Is the sun right?', visibility: 'public', props: {} },
];
const links = [
  ['produced', 'e_sun', 'e_old'],
  ['answers', 'e_sun', 'e_q'],
];
const ctx = {
  now: '2026-10-17T12:00:00Z',
  read: async (q: Record<string, any>) => {
    if (q.items) return items.filter((e) => e.type === q.items.type);
    if (q.related) return links.filter(([t, from]) => t === q.relation && from === q.related).map(([, , to]) => items.find((e) => e.id === to));
    throw new Error(`no read ${JSON.stringify(q)}`);
  },
};

test('test_report replaces the result on the same build, makes one on a new build, and names what it does not know', async () => {
  const report = handler['software.test_report'];
  const same = await report({ build: '1.0.0', results: [{ test: 'Sun.MatchesNoaa', passed: true, picture: '.proof/sun.png' }, { test: 'Nobody', passed: true }] }, ctx);
  assert.deepEqual(same.ops.map((o: { op: string; id?: string }) => [o.op, o.id]), [['update', 'e_old']]);
  assert.deepEqual(same.drop_pictures, ['e_old'], 'a test run again loses the pictures of its results');
  assert.deepEqual(same.answer.unknown, ['Nobody']);
  assert.deepEqual(same.answer.send_pictures, [{ result: 'e_old', picture: '.proof/sun.png' }], 'its question is public, so the picture is owed');

  const fresh = await report({ build: '1.0.1', results: [{ test: 'e_pole', passed: false, value: '3 mm out' }] }, ctx);
  assert.deepEqual(fresh.ops.map((o: { op: string; type: string }) => [o.op, o.type]), [['create', 'test_result'], ['link', 'produced']]);
  assert.deepEqual([fresh.answer.passed, fresh.answer.failed, fresh.answer.send_pictures], [0, 1, []]);

  await assert.rejects(report({ build: ' ', results: [{ test: 'e_pole', passed: true }] }, ctx), /needs "build"/);
  await assert.rejects(report({ build: '1', results: [{ test: 'e_pole', passed: true }, { test: 'e_pole', passed: true }] }, ctx), /reported twice/);
  assert.deepEqual(await report({ build: '1', results: [{ test: 'Nobody', passed: true }] }, ctx), { answer: { build: '1', recorded: 0, passed: 0, failed: 0, unknown: ['Nobody'] } });
});
