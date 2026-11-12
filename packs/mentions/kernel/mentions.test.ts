// The mentions projector, run without a database: facts and the items they wrote in, the rows of mention out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { named, project, written, type Rows } from './mentions.ts';

test('an item names the ids in its note and its fields, never its own', () => {
  assert.deepEqual(named({ id: 'e_aaaaaaaa', body: 'Rests on e_bbbbbbbb, and e_aaaaaaaa itself; xe_cccccccc is no id', props: { about: 'e_dddddddd', list: ['e_bbbbbbbb'] } }), ['e_bbbbbbbb', 'e_dddddddd']);
});

test('only facts on a note or a field are read again: not the head, not a link, not what was forgotten', () => {
  assert.deepEqual(written([
    ['+', 'e_aaaaaaaa', 'status', 'done'], ['+', 'e_bbbbbbbb', 'body', 'x'], ['+', 'r_cccccccc', 'link', ['about', 'e_a', 'e_b']],
    ['-', 'e_dddddddd', 'goal'], ['+', 'e_eeeeeeee', 'notes', 'y'], ['+', 'e_eeeeeeee', 'forgotten', true], ['+', 'task', 'type_def', {}],
  ]), ['e_bbbbbbbb', 'e_dddddddd']);
});

test('what each written item names replaces its rows of mention', async () => {
  const items: Record<string, { id: string; body: string; props: Record<string, unknown> }> = { e_aaaaaaaa: { id: 'e_aaaaaaaa', body: 'See e_bbbbbbbb', props: {} } };
  const replaced: unknown[] = [];
  const rows: Rows = { item: async (id) => items[id], replace: async (...args) => void replaced.push(args) };
  await project({} as KernelContext, [['+', 'e_aaaaaaaa', 'body', 'See e_bbbbbbbb'], ['+', 'e_zzzzzzzz', 'body', 'gone']], rows);
  assert.deepEqual(replaced, [['mention', 'from_id', 'e_aaaaaaaa', [{ from_id: 'e_aaaaaaaa', to_id: 'e_bbbbbbbb' }]]]);
});
