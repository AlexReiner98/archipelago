// The turns pack's part of a session's turns (packs/turns/parts/turns), run as its worker runs it: the run and its two
// named reads in, marks the host's check takes out (packs/walls/page/part-check.js), a press that folds a turn open,
// and one that follows it up with the pack's action.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import turns from '../packs/turns/parts/turns/index.js';

const input = {
  item: { id: 'e_run00001', type: 'run', title: 'Turns as a part' },
  views: {
    turns: {
      turns: [
        { began: '2026-11-12T22:00:00.000Z', by: 'person', gist: 'Build it', end: 'asked', question: 'Should a turn fold open? It keeps one line.', tools: { edit: 3, shell: 2 }, tests: { ok: 1 }, tokens: { input: 12000, output: 800 } },
        { began: '2026-11-12T21:00:00.000Z', by: 'session', from: 'e_run00002', gist: 'Go ahead', end: 'done', files: ['ui/turns.js'] },
        { began: '2026-11-12T20:00:00.000Z', by: 'session', from: 'local_95d272fc', gist: 'Start here', end: 'done' },
      ],
      more: 3,
      names: { e_run00002: { title: 'UI as a pack', name: 'Sark' } },
    },
    story: { beats: [{ n: 1, at: '2026-11-12T21:30:00.000Z', said: 'Turns are not items: a part reads a view.', finding: true }] },
  },
};

test('the part answers with marks the host checks, folds a turn open, and follows it up', async () => {
  const sent: unknown[] = [];
  const part = turns(input, { marks: (m: unknown) => checkMarks(m), act: async (action: string, params: unknown) => (sent.push([action, params]), { status: 'applied', created: { task: 'e_task0001' } }) });
  checkMarks(part.marks);
  const said = JSON.stringify(part.marks);
  assert.ok(said.indexOf('Build it') < said.indexOf('Turns are not items') && said.indexOf('Turns are not items') < said.indexOf('Go ahead'), 'newest first, the beat at its time');
  assert.match(said, /Session Sark/);
  assert.match(said, /"item":"e_run00002"/, 'the session that started a turn is an item mark: a press opens its page');
  assert.match(said, /3 older/);
  assert.doesNotMatch(said, /follow:/, 'folded, a turn offers nothing to press but itself');

  const key = 'turn:2026-11-12T22:00:00.000Z';
  const opened = await part.on({ key, name: 'press' });
  checkMarks(opened);
  assert.match(JSON.stringify(opened), /It keeps one line/);
  checkMarks(await part.on({ key: `follow:${key}`, name: 'press' }));
  assert.deepEqual(sent, [['turns.follow_up', { run: 'e_run00001', said: 'Should a turn fold open? It keeps one line.', at: '2026-11-12T22:00:00.000Z' }]]);
  assert.match(JSON.stringify(part.update(input)), /Followed up: a task/, 'once gone out, the row says so');
  assert.equal(await part.on({ key: 'follow:turn:nonsense', name: 'press' }), undefined);
  // One that is refused says why, and may be pressed again.
  const refused = turns(input, { marks: () => {}, act: async () => ({ error: 'A rule held it.' }) });
  await refused.on({ key, name: 'press' });
  const refusal = JSON.stringify(await refused.on({ key: `follow:${key}`, name: 'press' }));
  assert.match(refusal, /Not sent: A rule held it\./);
  assert.match(refusal, /Try again/);
  checkMarks(part.update({ item: input.item, views: { turns: null, story: null } }));
});
