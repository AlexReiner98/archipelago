// Packs authored on the map (src/map-packs.ts): an item of core's pack type is a pack of data alone, read beside the
// server's, off until the owner adds it, checked whole when it is written, and on the log as any pack is.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../src/workspaces.ts'; // as on a server: a change to a pack item makes the log and the packs on follow
import { madeProblems } from '../src/map-packs.ts';
import { setIslands, setPack } from '../src/packstate.ts';
import { Registry } from '../src/packs.ts';
import { agent, fresh, freshWith, human, make, packsWith } from './map.ts';

const RECIPES = {
  types: [{ id: 'recipes.dish', title: 'Dish', description: 'A dish we cook.', extends: 'record', fields: { serves: { type: 'number' } } }],
  links: [{ id: 'recipes.goes_with', title: 'Goes with', inverse: 'Goes with', extends: 'about', from: ['recipes.dish'], to: ['recipes.dish'], description: 'Served together.' }],
  styles: [{ id: 'recipes.told', type: 'instruction', title: 'Dishes', body: 'Say how many a dish serves.', props: { for: ['session_start'] } }],
};
const recipes = (manifest: Record<string, unknown> = RECIPES) => ({ op: 'create', ref: 'p', type: 'pack', title: 'Recipes', body: 'What we cook.', props: { name: 'recipes', manifest } }) as const;

test('a pack made on the map holds data alone, its own names, and rules that only tighten', () => {
  const taken = new Set(['core', 'local']);
  const said = (manifest: unknown, name = 'recipes') => madeProblems({ title: 'Recipes', props: { name, manifest } }, taken).join('; ');
  assert.equal(said(RECIPES), '');
  assert.match(said({ handlers: [{ event: 'x' }], reach: {} }), /holds handlers, reach/);
  assert.match(said({ types: [{ id: 'dish', title: 'Dish', description: '', extends: 'record' }] }), /named recipes\.<what>: dish/);
  assert.match(said({ rules: [{ id: 'keep', stream: 'facts', keep: { latest: true } }] }), /only holds, refuses/);
  assert.match(said({ rules: [{ id: 'mine', when: { actor: 'agent' }, then: 'hold', lifted: 'agent_mine' }] }), /only holds, refuses/);
  assert.match(said({ styles: [{ id: 'recipes.look', settings: {} }] }), /are looks/);
  assert.match(said({ views: [{ id: 'recipes.read', shape: 'data' }] }), /not drawn by the kernel/);
  assert.match(said(RECIPES, 'core'), /already/);
  assert.match(said(RECIPES, 'Recipes!'), /lower case/);
});

test('the owner adds a pack made on the map, its types are used, and its manifest is on the log', async () => {
  const l = await fresh();
  const { p } = await make(l, [recipes()]);
  assert.equal(l.registry.states.get('recipes')?.state, 'off', 'off until the owner adds it');
  await assert.rejects(make(l, [{ op: 'create', type: 'recipes.dish', title: 'Soup' }]));

  await setPack(l, human, { pack: 'recipes', on: true });
  assert.equal(l.registry.states.get('recipes')?.state, 'active');
  const { a, b } = await make(l, [
    { op: 'create', ref: 'a', type: 'recipes.dish', title: 'Soup', props: { serves: 4 } },
    { op: 'create', ref: 'b', type: 'recipes.dish', title: 'Bread' },
    { op: 'link', type: 'recipes.goes_with', from: 'a', to: 'b' },
  ]);
  assert.equal((await l.entity(a))!.kind, 'record');
  assert.ok(b);
  const { rows } = await l.db.query<{ value: { text?: string } }>(`select value from log_fact where id = 'pack:recipes' and op = '+'`);
  assert.equal(JSON.parse(rows.at(-1)!.value.text!).types[0].id, 'recipes.dish', 'the manifest made on the map is kept on the log');

  // An edit to the added pack is said on the log again, and stays on.
  await make(l, [{ op: 'update', id: p, props: { manifest: { ...RECIPES, types: [{ ...RECIPES.types[0], fields: { serves: { type: 'number' }, spice: { type: 'string' } } }] } } }]);
  const again = await l.db.query(`select 1 from log_fact where id = 'pack:recipes' and op = '+'`);
  assert.equal(again.rows.length, 2);
  assert.equal(l.registry.states.get('recipes')?.state, 'active');
  await make(l, [{ op: 'update', id: a, props: { spice: 'mild' } }]);

  // Retired, it leaves the registry and what it made stays, dormant.
  await make(l, [{ op: 'update', id: p, status: 'retired' }]);
  assert.equal(l.registry.states.has('recipes'), false);
  assert.equal(l.registry.type('recipes.dish')?.dormant, true);
  assert.equal((await l.entity(a))!.title, 'Soup');
});

test('a pack made on the map that would not load is refused when it is written', async () => {
  const l = await fresh();
  await assert.rejects(make(l, [recipes({ types: [{ id: 'recipes.dish', title: 'Dish', description: '', extends: 'no_such' }] })]), /as it would be once added: .*no_such/);
  await assert.rejects(make(l, [recipes({ handlers: [{ event: 'x' }] })]), /holds handlers/);
});

test('an agent may make a pack, and its edit of one waits for the owner', async () => {
  const l = await fresh();
  const made = await l.change(agent, { ops: [recipes()], reason: 'test' });
  const p = (made as { created?: Record<string, string> }).created?.p ?? (await make(l, [recipes()])).p;
  const edit = await l.change(agent, { ops: [{ op: 'update', id: p, props: { version: '0.2.0' } }], reason: 'test' });
  assert.equal(edit.status, 'proposed');
  assert.equal((edit as { held_by?: { rule: string } }).held_by?.rule, 'agent_packs');
});

test('on an island map, a pack made there is judged by the island rules', async () => {
  const l = await fresh();
  await setIslands(l, human, true);
  await make(l, [recipes()]);
  await setPack(l, human, { pack: 'recipes', on: true });
  assert.equal(l.registry.states.get('recipes')?.state, 'active', 'built on the shared set alone, it is taken');
  await assert.rejects(make(l, [{ ...recipes({ requires: ['core', 'work'], types: RECIPES.types }), ref: 'q', props: { name: 'menus', manifest: { requires: ['core', 'work'], types: [{ id: 'menus.menu', title: 'Menu', description: '', extends: 'record' }] } } }]), /not taken on an island map: it requires work/);
});

test('a pack made on the map cannot take a name a server pack declares, even one off here', async () => {
  const other = { id: 'kitchen', version: '0.1.0', title: 'Kitchen', description: '', requires: ['core'], types: [{ id: 'recipes.dish', title: 'Dish', description: '', extends: 'record' }] };
  const l = await freshWith(new Registry(packsWith(other)));
  l.registry.turnOff(['kitchen']);
  assert.equal(l.registry.states.get('kitchen')?.state, 'off');
  await assert.rejects(make(l, [recipes({ types: RECIPES.types })]), /a pack this server has declares recipes\.dish already/);
});

test('a rule in a pack made on the map only tightens: it lets nothing through that core holds', async () => {
  const l = await fresh();
  await assert.rejects(make(l, [recipes({ rules: [{ id: 'recipes.go', when: { actor: 'agent' }, then: 'apply' }] })]), /then is hold, refuse/);
  await assert.rejects(make(l, [recipes({ rules: [{ id: 'agent_changes', when: { actor: 'agent' }, then: 'hold' }] })]), /named recipes\.<what>/);
  const task = { op: 'create', type: 'task', title: 'A task' } as const;
  const before = (await l.change(agent, { ops: [task], reason: 'test' })).status;
  await make(l, [recipes({ ...RECIPES, rules: [{ id: 'recipes.hold', when: { actor: 'agent', type: 'recipes.dish' }, then: 'hold', say: 'Dishes are the cook’s.' }] })]);
  await setPack(l, human, { pack: 'recipes', on: true });
  assert.equal((await l.change(agent, { ops: [task], reason: 'test' })).status, before, 'what core decided stays as it was');
  const dish = await l.change(agent, { ops: [{ op: 'create', type: 'recipes.dish', title: 'Soup' }], reason: 'test' });
  assert.equal(dish.status, 'proposed');
});
