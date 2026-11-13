// A change set (ui/changes.js): what came, left and changed between two positions of the log, worked out with the
// projector the page runs, from facts alone and with no page; and the tail sends who made each entry and why.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { factsAfter, headPos } from '../packs/log/kernel/tail.ts';
import { uiFile } from '../packs/surface/kernel/ui-files.ts';
import { fresh, human, make } from './map.ts';

/** ui/changes.js and the projector it imports, as the server serves them. */
async function changes() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-changes-'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dir, 'project.js'), (await uiFile('project.js', null)).body as string);
  writeFileSync(join(dir, 'changes.js'), (await uiFile('changes.js', null)).body as string);
  return import(pathToFileURL(join(dir, 'changes.js')).href);
}

const kinds = { isOpen: (_t: string, s: string) => s !== 'done', starterOf: (t: string) => t, relationFamily: (...r: string[]) => r };
const item = (id: string, title: string, status = 'todo') => ({ id, type: 'task', title, body: '', status, visibility: 'workspace', owner: null, is_open: true, props: {}, archived_at: null });
const link = (id: string, type: string, from: string, to: string) => ({ id, type, from_id: from, to_id: to, props: {}, valid_to: null });
const agentBy = { actor: 'e_agent001', name: 'Claude', run: 'e_run00001', word: 'Coll', of: 'agent', reason: 'Finished the projector' };

test('a change set says what came, left and changed, and who did it, from facts alone', async () => {
  const { changeSet, touched, said } = await changes();
  const held = {
    items: new Map([['e_aaaaaaaa', item('e_aaaaaaaa', 'Tail the log')], ['e_bbbbbbbb', item('e_bbbbbbbb', 'Old one')], ['e_cccccccc', item('e_cccccccc', 'Left alone')]]),
    links: new Map([['r_aaaaaaaa', link('r_aaaaaaaa', 'part_of', 'e_aaaaaaaa', 'e_cccccccc')]]),
  };
  const before = JSON.stringify([...held.items, ...held.links]);
  const entries = [
    { pos: 4, at: '2026-11-05T10:00:00.000Z', facts: [['+', 'e_aaaaaaaa', 'title', 'Before the set']] },
    {
      pos: 5, at: '2026-11-05T10:01:00.000Z', by: agentBy,
      facts: [
        ['+', 'e_aaaaaaaa', 'status', 'doing'], ['+', 'e_aaaaaaaa', 'tokens_estimated', 40],
        ['+', 'e_dddddddd', 'type', 'task'], ['+', 'e_dddddddd', 'title', 'New one'], ['+', 'e_dddddddd', 'status', 'todo'],
        ['+', 'r_bbbbbbbb', 'link', ['depends_on', 'e_dddddddd', 'e_aaaaaaaa']],
        ['+', 'e_bbbbbbbb', 'archived', true],
        ['-', 'r_aaaaaaaa', 'link'],
      ],
    },
    { pos: 6, at: '2026-11-05T10:02:00.000Z', by: { actor: 'e_owner001', of: 'human', reason: 'Said again' }, facts: [['+', 'e_cccccccc', 'title', 'Left alone']] },
    { pos: 7, at: '2026-11-05T10:03:00.000Z', by: agentBy, facts: [['+', 'e_eeeeeeee', 'type', 'task'], ['+', 'e_eeeeeeee', 'title', 'Brief'], ['+', 'e_eeeeeeee', 'archived', true]] },
  ];
  const set = changeSet(held, kinds, entries, { after: 4 });
  assert.equal(JSON.stringify([...held.items, ...held.links]), before, 'what it was handed is unchanged');
  assert.deepEqual([set.from, set.to], [4, 7]);
  const by = Object.fromEntries(set.items.map((c: any) => [c.id, c]));
  assert.deepEqual(Object.keys(by).sort(), ['e_aaaaaaaa', 'e_bbbbbbbb', 'e_dddddddd'], 'what was said again as it was, and what came and left in the set, are no change');
  assert.equal(by.e_aaaaaaaa.did, 'changed');
  assert.deepEqual(by.e_aaaaaaaa.fields, [{ field: 'status', was: 'todo', now: 'doing' }, { field: 'tokens_estimated', was: null, now: 40 }], 'the entry before the set is not in it');
  assert.equal(by.e_dddddddd.did, 'came');
  assert.equal(by.e_bbbbbbbb.did, 'left');
  assert.deepEqual(by.e_aaaaaaaa.by, agentBy, 'who, on whose word and why');
  assert.equal(by.e_aaaaaaaa.pos, 5);
  const links = Object.fromEntries(set.links.map((c: any) => [c.id, c]));
  assert.deepEqual([links.r_bbbbbbbb.did, links.r_bbbbbbbb.type, links.r_bbbbbbbb.from, links.r_bbbbbbbb.to], ['linked', 'depends_on', 'e_dddddddd', 'e_aaaaaaaa']);
  assert.equal(links.r_aaaaaaaa.did, 'unlinked');
  // What a page traces: each item changed, and the ends of each link, the item's own change first.
  const marks = touched(set);
  assert.deepEqual([...marks.keys()].sort(), ['e_aaaaaaaa', 'e_bbbbbbbb', 'e_cccccccc', 'e_dddddddd']);
  assert.equal(marks.get('e_cccccccc').did, 'unlinked');
  assert.equal(said(by.e_aaaaaaaa), 'doing, tokens_estimated');
  assert.equal(said(links.r_bbbbbbbb), 'linked depends on');

  // A forget takes its links with it; what the reader can no longer see left.
  const forgot = changeSet(held, kinds, [{ pos: 8, at: '2026-11-05T10:04:00.000Z', facts: [['+', 'e_aaaaaaaa', 'forgotten', true]] }], { after: 7, gone: ['e_bbbbbbbb'] });
  assert.deepEqual(forgot.items.map((c: any) => [c.id, c.did]).sort(), [['e_aaaaaaaa', 'left'], ['e_bbbbbbbb', 'left']]);
  assert.deepEqual(forgot.links.map((c: any) => [c.id, c.did]), [['r_aaaaaaaa', 'unlinked']]);
  assert.deepEqual(changeSet(held, kinds, [], { after: 8 }), { from: 8, to: 8, items: [], links: [] }, 'nothing between, nothing changed');
});

test('the tail says who made each entry, on whose word, and why, opened', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Traced' }]);
  const start = await headPos(l.db);
  await l.change(human, { reason: 'Started on it', authority: { of: 'human' }, ops: [{ op: 'update', id: made.t, status: 'doing' }] } as any);
  const read = await factsAfter(l.db, { after: start, ids: [made.t] });
  assert.equal(read.entries.length, 1);
  const by = read.entries[0].by!;
  assert.equal(by.reason, 'Started on it', 'the reason, opened');
  assert.equal(by.of, 'human');
  assert.equal(by.actor, 'human:test', 'the actor, as the log holds it');
});
