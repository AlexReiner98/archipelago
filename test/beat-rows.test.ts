// What the runtime hands the parts on `traces` (packs/surface/page/beat-rows.js, task e_p3tygg6p): the rows a beat
// touched as they were and are. Its half and the part's half (packs/catch_up/parts/changes.js) together must say what
// the page's change set (ui/changes.js) says, on the same facts.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { uiFile } from '../packs/surface/kernel/ui-files.ts';
// @ts-expect-error a part's module, plain JavaScript
import { changeSet as partSet } from '../packs/catch_up/parts/changes.js';

/** The page's modules and the projector they import, as the server serves them. */
async function served() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-beat-'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['project.js', 'changes.js', 'beat-rows.js']) writeFileSync(join(dir, f), (await uiFile(f, null)).body as string);
  const at = (f: string) => import(pathToFileURL(join(dir, f)).href);
  return { ...(await at('changes.js')), ...(await at('beat-rows.js')) };
}

const kinds = { isOpen: (_t: string, s: string) => s !== 'done', starterOf: (t: string) => t, relationFamily: (...r: string[]) => r };
const item = (id: string, title: string, status = 'todo') => ({ id, type: 'task', title, body: '', status, visibility: 'workspace', owner: null, is_open: true, props: {}, archived_at: null });
const link = (id: string, type: string, from: string, to: string) => ({ id, type, from_id: from, to_id: to, props: {}, valid_to: null });
const by = { actor: 'e_agent001', of: 'agent', reason: 'Moved it' };
const held = () => ({
  items: new Map([['e_aaaaaaaa', item('e_aaaaaaaa', 'Tail the log')], ['e_bbbbbbbb', item('e_bbbbbbbb', 'Old one')], ['e_cccccccc', item('e_cccccccc', 'Left alone')]]),
  links: new Map([['r_aaaaaaaa', link('r_aaaaaaaa', 'part_of', 'e_aaaaaaaa', 'e_cccccccc')]]),
});
const entries = [
  { pos: 5, at: '2026-11-05T10:01:00.000Z', by, facts: [['+', 'e_aaaaaaaa', 'status', 'doing'], ['+', 'e_dddddddd', 'type', 'task'], ['+', 'e_dddddddd', 'title', 'New one'], ['+', 'e_dddddddd', 'status', 'todo'], ['+', 'r_bbbbbbbb', 'link', ['depends_on', 'e_dddddddd', 'e_aaaaaaaa']], ['+', 'e_bbbbbbbb', 'archived', true], ['-', 'r_aaaaaaaa', 'link']] },
  { pos: 6, at: '2026-11-05T10:02:00.000Z', facts: [['+', 'e_cccccccc', 'title', 'Left alone']] },
  { pos: 7, at: '2026-11-05T10:03:00.000Z', by, facts: [['+', 'e_aaaaaaaa', 'title', 'Tailed']] },
];

test("the runtime's rows and the part's comparison say what the page's change set says", async () => {
  const { changeSet, beatRows } = await served();
  const h = held();
  const before = JSON.stringify([...h.items, ...h.links]);
  const beat = beatRows(h, kinds, entries, { after: 4, gone: ['e_cccccccc'] });
  assert.equal(JSON.stringify([...h.items, ...h.links]), before, 'what it was handed is unchanged');
  assert.deepEqual([beat.from, beat.to], [4, 7]);
  assert.ok(beat.rows.every((r: any) => 'was' in r && 'now' in r && r.pos), 'each row as it was and is, with where');
  assert.deepEqual(JSON.parse(JSON.stringify(partSet(beat))), JSON.parse(JSON.stringify(changeSet(held(), kinds, entries, { after: 4, gone: ['e_cccccccc'] }))));
  assert.deepEqual(beatRows(held(), kinds, [], { after: 8 }), { from: 8, to: 8, rows: [] });
});

test('what was missed, entry by entry, each from where the one before left the rows', async () => {
  const { missedRows } = await served();
  const missed = missedRows(held(), kinds, entries);
  assert.deepEqual(missed.map((e: any) => e.pos), [5, 6, 7]);
  const last = missed[2].rows.find((r: any) => r.id === 'e_aaaaaaaa');
  assert.deepEqual([last.was.status, last.was.title, last.now.title], ['doing', 'Tail the log', 'Tailed'], 'the third entry starts where the first left it');
  assert.deepEqual(missed[0].by, by);
});
