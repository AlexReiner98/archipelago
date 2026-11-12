// Islands turned on, run without a database: a context whose reads answer from a few items in memory, the change out.
// The whole of it against a real map is test/islands.test.ts and test/island-items.test.ts, through the shim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { firstIsland, islandBlockers, moveOntoIslands, type IslandOp } from './island-start.ts';

const type = (id: string, pack: string, lineage = [id]) => ({ id, pack, system: false, lineage });
const types = new Map([type('task', 'work'), type('note', 'core'), type('person', 'core', ['person', 'actor']), type('song', 'music')].map((t) => [t.id, t]));
const packs = [{ id: 'core', title: 'Core', shared: ['note'] }, { id: 'work', title: 'Work' }, { id: 'music', title: 'Music' }];

/** A context over items on no island (id, type), the music pack the island rules would switch off. */
function context(items: { id: string; type: string }[], off: [string, string][] = []) {
  const asked: string[] = [];
  const reads = async (q: Record<string, unknown>) => {
    asked.push(Object.keys(q)[0]);
    if (q.islands_off) return { local: 'local', off };
    if (q.held_types) return (q.held_types as string[]).filter((t) => items.some((i) => i.type === t));
    if (q.workspace_name) return 'Studio';
    if (q.unplaced) {
      const { types: of, after } = q.unplaced as { types: string[]; after: string };
      return items.filter((i) => of.includes(i.type) && i.id > after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 500);
    }
    throw new Error(`not read here: ${Object.keys(q)[0]}`);
  };
  const registry = { types, packs, type: (id: string) => types.get(id) };
  return { ctx: { reads, registry } as unknown as KernelContext, asked };
}

test('a pack the island rules would switch off blocks islands only when the map holds its items', async () => {
  const off: [string, string][] = [['music', 'it speaks on a type of another pack']];
  assert.equal(await islandBlockers(context([{ id: 'e_1', type: 'task' }], off).ctx), undefined);
  assert.match((await islandBlockers(context([{ id: 'e_2', type: 'song' }], off).ctx))!, /^Islands would switch off the pack music, and this map has items of its types: it speaks on a type of another pack\./);
});

test('what is on no island moves onto one island a pack, the shared set on the first, actors left where they are', async () => {
  const made: { reason: string; ops: IslandOp[] }[] = [];
  const { ctx } = context([{ id: 'e_b', type: 'note' }, { id: 'e_a', type: 'task' }, { id: 'e_c', type: 'song' }, { id: 'e_p', type: 'person' }]);
  assert.deepEqual(await moveOntoIslands(ctx, async (input) => void made.push(input)), { islands: 2, moved: 3 });
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].ops, [
    { op: 'create', ref: 'island0', type: 'island', title: 'Studio: Work', status: 'current', visibility: 'shared', props: { pack: 'work' } },
    { op: 'create', ref: 'island1', type: 'island', title: 'Studio: Music', status: 'current', visibility: 'shared', props: { pack: 'music' } },
    { op: 'update', id: 'e_a', props: { island: '{island0}' } },
    { op: 'update', id: 'e_b', props: { island: '{island0}' } },
    { op: 'update', id: 'e_c', props: { island: '{island1}' } },
  ]);
});

test('with nothing on no island nothing is made, and a lone shared item goes on an island speaking core', async () => {
  const none = context([]);
  assert.deepEqual(await moveOntoIslands(none.ctx, async () => assert.fail('no change')), { islands: 0, moved: 0 });
  const made: IslandOp[][] = [];
  await moveOntoIslands(context([{ id: 'e_n', type: 'note' }]).ctx, async (input) => void made.push(input.ops));
  assert.deepEqual(made[0][0], { op: 'create', ref: 'island0', type: 'island', title: 'Studio', status: 'current', visibility: 'shared', props: { pack: 'core' } });
});

test("a new map's first island is named after it and speaks core", async () => {
  const made: unknown[] = [];
  await firstIsland(async (input) => void made.push(input), 'Studio');
  assert.deepEqual(made, [{ ops: [{ op: 'create', type: 'island', title: 'Studio', status: 'current', visibility: 'shared', props: { pack: 'core' } }], reason: 'A new workspace starts on islands' }]);
});
