// Where each pack stands, brought onto the island: a state that moved is changed, a pack kept as an item joins the
// island, a pack the workspace is not offered is off and says so, and nothing that already shows is sent again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateOps, statesNow, type IslandPack } from './states.ts';

const pack = (id: string, props: Record<string, unknown> = {}): IslandPack => ({ id: `e_${id}`, props: { pack_id: id, island: 'isl', ...props } });

test('a state that moved is changed, and one that shows already is left', () => {
  const { ops, changed } = stateOps([{ id: 'calendar', state: 'off' }, { id: 'core', state: 'active' }], [pack('calendar', { state: 'active' }), pack('core', { state: 'active', why: '' })], 'isl');
  assert.deepEqual(ops, [{ op: 'update', id: 'e_calendar', props: { state: 'off', why: '' } }]);
  assert.deepEqual(changed, ['calendar']);
});

test('a waiting pack says why', () => {
  const { ops } = stateOps([{ id: 'time_views', state: 'waiting', why: 'needs type:event' }], [pack('time_views', { state: 'active' })], 'isl');
  assert.deepEqual(ops, [{ op: 'update', id: 'e_time_views', props: { state: 'waiting', why: 'needs type:event' } }]);
});

test('a pack kept as an item joins the island at home on the map; one only a repository holds waits for the code\'s sync', () => {
  const { ops } = stateOps([{ id: 'recipes', title: 'Recipes', version: '0.1.0', state: 'active', item: 'e_item' }, { id: 'newpack', state: 'off' }], [], 'isl');
  assert.deepEqual(ops, [{ op: 'create', type: 'anatomy.pack', title: 'Recipes', props: { island: 'isl', pack_id: 'recipes', home: 'item', kind: 'island', version: '0.1.0', state: 'active', why: '' } }]);
});

test('a pack the workspace is not offered is off, saying so, once', () => {
  const first = stateOps([], [pack('science', { state: 'active' })], 'isl');
  assert.equal((first.ops[0] as any).props.state, 'off');
  assert.deepEqual(stateOps([], [pack('science', (first.ops[0] as any).props)], 'isl').ops, []);
});

test('the island is found by its sync item, and only its packs are read as the island\'s', async () => {
  const read = async (q: any) => (q.items?.type === 'anatomy.sync' ? [{ props: { island: 'isl' } }] : q.pack_states ? [{ id: 'calendar', state: 'off' }] : [pack('calendar', { state: 'active' }), { id: 'e_other', props: { pack_id: 'calendar', island: 'elsewhere', state: 'active' } }]);
  const now = await statesNow({ read });
  assert.deepEqual(now.ops, [{ op: 'update', id: 'e_calendar', props: { state: 'off', why: '' } }]);
  assert.match(now.reason, /calendar pack stands/);
});
