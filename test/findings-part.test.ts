// The findings pack's part (packs/findings/parts/findings), run as its worker runs it: what it is handed in, marks the
// host's check takes out (packs/walls/page/part-check.js), and a press on a working finding answered with the pack's
// action.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks as checkAny } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import findings from '../packs/findings/parts/findings/index.js';
import { readFileSync } from 'node:fs';

/** The marks the part names in its manifest: the host refuses any other it answers with. */
const kinds = JSON.parse(readFileSync(new URL('../packs/findings/pack.json', import.meta.url), 'utf8')).parts[0].marks;
const checkMarks = (marks: unknown) => checkAny(marks, { kinds });

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

test('it reads the schema’s words, tips each value, keeps Stand by in a menu and shows a finding’s note', async () => {
  const words = { types: { finding: { title: 'Result', open: ['working'], closed: [] } }, links: {} };
  const items = [{ id: 'e_bbbbbbbb', type: 'finding', title: 'Base load is 9 kW', body: 'Read off the **meter**, 3 days.', value: 9, unit: 'kW', as_of: '2026-11-10' }];
  const part = findings({ item: { id: 'e_island01', type: 'island' }, items: [], words }, { marks: () => {}, act: async () => ({}) });
  assert.match(JSON.stringify(part.marks), /No results on this island yet/, 'the type is named as the island’s schema names it');
  part.update({ item: { id: 'e_island01', type: 'island' }, items, words });
  const opened = checkMarks(await part.on({ key: 'working', name: 'press' }));
  const all = (n: { mark: string; kids?: unknown[] }): { mark: string; key?: string; at: Record<string, unknown>; words?: string; kids?: unknown[] }[] => [n as never, ...((n.kids ?? []) as never[]).flatMap(all)];
  const menu = all(opened).find((n) => n.mark === 'menu')!;
  assert.equal((menu.kids![0] as { key: string }).key, 'stand:e_bbbbbbbb', 'Stand by is in the row’s menu');
  assert.ok(all(opened).some((n) => n.mark === 'text' && n.at.tip === 'As of 2026-11-10'), 'its age tips the day it is as of');
  assert.ok(all(opened).some((n) => n.mark === 'text' && n.at.tip === 'Base load is 9 kW'), 'its claim tips itself whole');
  assert.ok(!all(opened).some((n) => n.mark === 'note'), 'the note is folded');
  const noted = checkMarks(await part.on({ key: 'note:e_bbbbbbbb', name: 'press' }));
  assert.equal(all(noted).find((n) => n.mark === 'note')?.words, 'Read off the **meter**, 3 days.');
});
