// The findings pack's part (packs/findings/parts/findings), run as its worker runs it: what it is handed in, marks the
// host's check takes out (packs/walls/page/part-check.js), and a press on a working finding answered with the pack's
// action.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import findings from '../packs/findings/parts/findings/index.js';

test('the part answers with marks the host checks, and sends its action on a press', async () => {
  const input = {
    item: { id: 'e_island01', type: 'island', title: 'Loads' },
    items: [
      { id: 'e_aaaaaaaa', type: 'finding', title: 'Peak load is 42 kW', value: 42, unit: 'kW', as_of: '2026-11-12', published: true },
      { id: 'e_bbbbbbbb', type: 'finding', title: 'Base load is 9 kW', value: 9, unit: 'kW' },
    ],
  };
  const sent: unknown[] = [];
  const part = findings(input, { marks: () => {}, act: async (action: string, params: unknown) => (sent.push([action, params]), { status: 'applied' }) });
  checkMarks(part.marks);
  assert.doesNotMatch(JSON.stringify(part.marks), /Base load/, 'the working findings are folded');
  const opened = await part.on({ key: 'working', name: 'press' });
  checkMarks(opened);
  assert.match(JSON.stringify(opened), /stand:e_bbbbbbbb/);
  assert.doesNotMatch(JSON.stringify(opened), /stand:e_aaaaaaaa/, 'a published finding has no press');
  checkMarks(await part.on({ key: 'stand:e_bbbbbbbb', name: 'press' }));
  assert.deepEqual(sent, [['findings.stand_by', { finding: 'e_bbbbbbbb' }]]);
  assert.equal(await part.on({ key: 'stand:nonsense', name: 'press' }), undefined);
  checkMarks(part.update({ item: input.item, items: [] }));
});
