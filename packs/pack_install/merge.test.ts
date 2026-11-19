// Install and upgrade as changes, without a database: a pack file and the map's items of it in, ops out. A small map
// here applies the ops as the write path would (refs to ids, props merged), so a test can install, edit as the owner
// and upgrade in turn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOne, plan } from './merge.js';
import { flat, hashOf, onMap, shipped, unflat } from './shape.js';
import handler from './handler.js';

type Item = { id: string; type: string; title: string; body?: string; status?: string; props: Record<string, any> };
type Op = Record<string, any>;

/** A map that takes ops: creates get ids, updates merge their props, part_of links are kept. */
function map() {
  const items = new Map<string, Item>();
  const parts: [string, string][] = [];
  let n = 0;
  return {
    items,
    apply(ops: Op[]) {
      const made: Record<string, string> = {};
      for (const op of ops) {
        if (op.op === 'create') {
          const id = `e_${++n}`;
          if (op.ref) made[op.ref] = id;
          items.set(id, { id, type: op.type, title: op.title, body: op.body ?? '', status: op.status ?? 'draft', props: structuredClone(op.props) });
        } else if (op.op === 'update') {
          const it = items.get(op.id)!;
          if (op.title !== undefined) it.title = op.title;
          if (op.body !== undefined) it.body = op.body;
          if (op.status !== undefined) it.status = op.status;
          for (const [k, v] of Object.entries(op.props ?? {})) v === null ? delete it.props[k] : (it.props[k] = structuredClone(v));
        } else if (op.op === 'link') parts.push([made[op.from] ?? op.from, made[op.to] ?? op.to]);
      }
      return made;
    },
    /** The pack's item and everything part of it, as the handler reads them. */
    of(id: string) {
      const pack = [...items.values()].find((i) => i.type === 'pack' && i.props.name === id);
      return pack ? [pack, ...parts.filter(([, to]) => to === pack.id).map(([from]) => items.get(from)!)] : [];
    },
    get(type: string, declares: string) {
      return [...items.values()].find((i) => i.type === type && i.props.declares === declares)!;
    },
  };
}

const v1 = {
  id: 'recipes',
  version: '0.1.0',
  title: 'Recipes',
  description: 'Dishes we cook.',
  requires: ['type:record'],
  types: [
    { id: 'recipes.dish', title: 'Dish', description: 'A dish we cook.', extends: 'record', fields: { serves: { type: 'number' }, cuisine: { type: 'string' } } },
    { id: 'recipes.course', title: 'Course', description: 'Where in the meal.', extends: 'record' },
    { of: 'task', fields: { dish: { type: 'string' } } },
  ],
  rules: [{ id: 'recipes.serves', when: { type: 'recipes.dish' }, then: 'hold', say: 'Say how many.' }],
  views: [{ id: 'recipes.menu', shape: 'rows', description: 'The menu.' }, { id: 'recipes.page', form: 'screen', title: 'Dish page', on: ['recipes.dish'], pieces: [] }],
  styles: [
    { id: 'recipes.how', type: 'instruction', title: 'Say the serving size', body: 'Always say how many it serves.', props: { for: ['session_start'] } },
    { id: 'recipes.all', type: 'lens', title: 'All dishes', props: { filter: { find: ['type recipes.dish'] } } },
  ],
  actions: [{ id: 'recipes.cook', verb: 'capture', title: 'Cook', description: 'Cook it.', input: { type: 'object' } }],
};
const next = (version: string, edit: (m: any) => void = () => {}) => { const m = structuredClone(v1) as any; m.version = version; edit(m); return m; };

test('install: the pack is an item, every declaration an item of its type part of it, each with what it came from', () => {
  const m = map();
  const done = plan(v1, []);
  assert.equal(done.reason, 'Install recipes 0.1.0');
  assert.deepEqual(done.changes, []);
  m.apply(done.ops);
  const [pack, ...parts] = m.of('recipes');
  assert.equal(pack.title, 'Recipes');
  assert.equal(pack.body, 'Dishes we cook.');
  assert.deepEqual(pack.props.manifest, { id: 'recipes', version: '0.1.0', requires: ['type:record'], actions: v1.actions }, 'what makes no part stays on the item');
  assert.match(pack.props.shipped.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(parts.map((p) => `${p.type}:${p.props.declares}`), [
    'type:recipes.dish', 'type:recipes.course', 'type:of:task', 'rule:recipes.serves', 'view:recipes.menu', 'screen:recipes.page', 'instruction:recipes.how', 'lens:recipes.all',
  ]);
  const dish = m.get('type', 'recipes.dish');
  assert.equal(dish.title, 'Dish');
  assert.equal(dish.body, 'A dish we cook.');
  assert.equal(dish.status, 'current');
  assert.deepEqual(dish.props.spec, { extends: 'record', fields: { serves: { type: 'number' }, cuisine: { type: 'string' } } });
  assert.deepEqual(dish.props.shipped, { pack: 'recipes', version: '0.1.0', hash: hashOf(v1.types[0]), value: v1.types[0] });
  const how = m.get('instruction', 'recipes.how');
  assert.equal(how.body, 'Always say how many it serves.');
  assert.deepEqual(how.props.spec, { type: 'instruction', props: { for: ['session_start'] } }, 'every part keeps its declaration in spec');
  assert.deepEqual(m.get('screen', 'recipes.page').props.spec, { form: 'screen', on: ['recipes.dish'], pieces: [] });
  assert.deepEqual(pack.props.shipped.value, v1, "the pack's is the whole file");
  assert.equal(m.get('rule', 'recipes.serves').title, 'recipes.serves', 'a rule with no title takes its id');
});

test('installing the same file again changes nothing', () => {
  const m = map();
  m.apply(plan(v1, []).ops);
  const again = plan(v1, m.of('recipes'));
  assert.equal(again.reason, 'Reinstall recipes 0.1.0');
  assert.deepEqual(again.ops, []);
  assert.deepEqual(again.changes, []);
});

test('upgrade: what only the pack changed is applied, what only the owner changed is kept, a type field by field', () => {
  const m = map();
  m.apply(plan(v1, []).ops);
  const course = m.get('type', 'recipes.course');
  const dish = m.get('type', 'recipes.dish');
  // The owner renames the course and adds a word to the dish's cuisine field.
  m.apply([{ op: 'update', id: course.id, title: 'Meal course' }]);
  m.apply([{ op: 'update', id: dish.id, props: { spec: { ...dish.props.spec, fields: { ...dish.props.spec.fields, cuisine: { type: 'string', description: 'Where it is from.' } } } } }]);
  const v2 = next('0.2.0', (x) => { x.types[0].fields.serves.description = 'How many it feeds.'; x.types[1].description = 'Where in the meal it comes.'; });
  const done = plan(v2, m.of('recipes'));
  assert.equal(done.reason, 'Upgrade recipes 0.1.0 → 0.2.0');
  assert.deepEqual(done.changes, [], 'nothing both changed: each field of a type is merged on its own');
  m.apply(done.ops);
  assert.deepEqual(m.items.get(dish.id)!.props.spec.fields, { serves: { type: 'number', description: 'How many it feeds.' }, cuisine: { type: 'string', description: 'Where it is from.' } });
  assert.equal(m.items.get(course.id)!.title, 'Meal course', "the owner's title stays");
  assert.equal(m.items.get(course.id)!.body, 'Where in the meal it comes.', "the pack's note is applied beside it");
  assert.deepEqual(done.summary.kept, [{ key: 'type:recipes.dish', fields: ['spec.fields.cuisine'] }, { key: 'type:recipes.course', fields: ['title'] }]);
  // On the next upgrade the pack leaves both alone: still the owner's.
  m.apply(plan(next('0.3.0'), m.of('recipes')).ops);
  assert.equal(m.items.get(course.id)!.title, 'Meal course');
  assert.equal(m.items.get(dish.id)!.props.spec.fields.cuisine.description, 'Where it is from.');
});

test("upgrade: where both changed a field, the owner's stands and the pack's is offered as a change of its own", () => {
  const m = map();
  m.apply(plan(v1, []).ops);
  const how = m.get('instruction', 'recipes.how');
  m.apply([{ op: 'update', id: how.id, body: 'Say how many it serves, and for whom.' }]);
  const v2 = next('0.2.0', (x) => { x.styles[0].body = 'Say the serving size first.'; x.styles[0].title = 'Serving size first'; });
  const done = plan(v2, m.of('recipes'));
  assert.equal(done.changes.length, 1);
  const [offer] = done.changes;
  assert.match(offer.reason, /^Upgrade recipes 0\.1\.0 → 0\.2\.0: you and the pack both changed "Say the serving size" \(body\)/);
  assert.deepEqual(offer.ops, [{ op: 'update', id: how.id, body: 'Say the serving size first.', props: { pack_merge: 'both' } }]);
  const own = done.ops.find((o: Op) => o.id === how.id);
  assert.equal(own.title, 'Serving size first', 'what only the pack changed applies in the one change set');
  assert.equal(own.body, undefined, 'what both changed is not in it');
  assert.deepEqual(own.props.shipped.value, v2.styles[0], 'what it came from is now the new file');
  m.apply(done.ops);
  assert.equal(m.items.get(how.id)!.body, 'Say how many it serves, and for whom.');
  // The owner declines the offer: the next upgrade, which leaves it alone, keeps theirs and asks nothing.
  const again = plan(next('0.2.1', (x) => { x.styles[0] = v2.styles[0]; }), m.of('recipes'));
  assert.deepEqual(again.changes, []);
  assert.deepEqual(again.summary.kept, [{ key: 'instruction:recipes.how', fields: ['body'] }]);
});

test("an offer on a type's spec is written over what the change before it applied", () => {
  const m = map();
  m.apply(plan(v1, []).ops);
  const dish = m.get('type', 'recipes.dish');
  m.apply([{ op: 'update', id: dish.id, props: { spec: { ...dish.props.spec, extends: 'event' } } }]);
  const v2 = next('0.2.0', (x) => { x.types[0].extends = 'thing'; x.types[0].fields.serves.description = 'How many.'; });
  const done = plan(v2, m.of('recipes'));
  m.apply(done.ops);
  assert.equal(m.items.get(dish.id)!.props.spec.extends, 'event');
  const [offer] = done.changes;
  assert.deepEqual(offer.ops[0].props.spec, { extends: 'thing', fields: { serves: { type: 'number', description: 'How many.' }, cuisine: { type: 'string' } } }, 'taking it keeps the field the upgrade applied');
});

test('upgrade: a dropped part is retired, unless the owner changed it; shipped again, it comes back', () => {
  const m = map();
  m.apply(plan(v1, []).ops);
  const course = m.get('type', 'recipes.course');
  const all = m.get('lens', 'recipes.all');
  m.apply([{ op: 'update', id: all.id, props: { spec: { ...all.props.spec, props: { filter: { find: ['type recipes.dish', 'type task'] } } } } }]);
  const v2 = next('0.2.0', (x) => { x.types.splice(1, 1); x.styles.pop(); });
  const done = plan(v2, m.of('recipes'));
  assert.deepEqual(done.summary.retired, ['type:recipes.course']);
  assert.deepEqual(done.summary.left, [{ key: 'lens:recipes.all', fields: ['spec.props'] }]);
  assert.ok(!done.ops.some((o: Op) => ['archive', 'forget'].includes(o.op)), 'nothing is deleted');
  m.apply(done.ops);
  assert.equal(m.items.get(course.id)!.status, 'retired');
  assert.equal(m.items.get(all.id)!.status, 'current');
  const back = plan(next('0.3.0'), m.of('recipes'));
  m.apply(back.ops);
  assert.equal(m.items.get(course.id)!.status, 'current', 'the item the pack retired is brought back, not made twice');
  assert.equal([...m.items.values()].filter((i) => i.props.declares === 'recipes.course').length, 1);
});

test('a part the owner retired stays retired when the pack ships it again', () => {
  const m = map();
  m.apply(plan(v1, []).ops);
  const course = m.get('type', 'recipes.course');
  m.apply([{ op: 'update', id: course.id, status: 'retired' }]);
  m.apply(plan(next('0.2.0'), m.of('recipes')).ops);
  assert.equal(m.items.get(course.id)!.status, 'retired');
});

test('code is named by runs, never put on the map', () => {
  const withLayout = next('0.1.0', (x) => { x.layouts = [{ id: 'recipes.plate', title: 'Plate', shape: 'plate', modules: { 'index.js': 'layouts/plate/index.js' } }]; });
  const files = { 'handler.js': 'aa11', 'layouts/plate/index.js': 'bb22' };
  const m = map();
  m.apply(plan(withLayout, [], { files }).ops);
  const plate = m.get('layout', 'recipes.plate');
  assert.equal(plate.status, 'kept');
  assert.deepEqual(plate.props.runs, [{ path: 'packs/recipes/layouts/plate/index.js', hash: 'bb22' }]);
  assert.deepEqual(m.of('recipes')[0].props.runs, [{ path: 'packs/recipes/handler.js', hash: 'aa11' }], "what no part claims is the pack's");
  const done = plan(withLayout, m.of('recipes'), { files: { ...files, 'handler.js': 'cc33' } });
  assert.deepEqual(done.ops, [{ op: 'update', id: m.of('recipes')[0].id, props: { runs: [{ path: 'packs/recipes/handler.js', hash: 'cc33' }] } }], 'a file changed is a change of runs alone');
});

test('an item never shipped differs where both are taken to have changed it', () => {
  const part = shipped(v1).parts[1];
  const own = onMap({ id: 'e_x', type: 'type', title: 'Course', props: { declares: 'recipes.course', spec: { extends: 'event' } } });
  const merged = mergeOne(own, part);
  assert.deepEqual(merged, { apply: {}, asked: { body: 'Where in the meal.', 'spec.extends': 'record' }, kept: [] });
});

test("a type's spec is compared by its fields one by one, and put back together", () => {
  const item = { type: 'type', title: 'Dish', body: '', fields: { spec: { extends: 'record', fields: { a: { type: 'string' } }, statuses: { open: ['x'] } } } };
  assert.deepEqual(flat(item), { title: 'Dish', body: '', 'spec.extends': 'record', 'spec.fields.a': { type: 'string' }, 'spec.statuses': { open: ['x'] } });
  assert.deepEqual(unflat(item, { 'spec.fields.b': { type: 'number' }, 'spec.fields.a': null, title: 'Plate' }), { title: 'Plate', spec: { extends: 'record', fields: { b: { type: 'number' } }, statuses: { open: ['x'] } } });
});

test('a pack file without an id, a part with none, or one declared twice is refused', () => {
  assert.throws(() => plan({ version: '1' }, []), /has an id/);
  assert.throws(() => plan({ id: 'x', rules: [{ when: {} }] }, []), /with no id/);
  assert.throws(() => plan({ id: 'x', types: [{ id: 'x.a' }, { id: 'x.a' }] }, []), /declares type:x\.a twice/);
});

test('the handler reads the pack item and its parts, and answers the plan', async () => {
  const m = map();
  m.apply(plan(v1, []).ops);
  const asked: unknown[] = [];
  const ctx = {
    read: async (q: any) => {
      asked.push(q);
      if (q.items) return m.of(q.items.where.name).slice(0, 1);
      if (q.parts_of) return m.of('recipes');
      return [];
    },
  };
  const out = await handler['pack_install.install']({ manifest: next('0.2.0') }, ctx);
  assert.equal(out.reason, 'Upgrade recipes 0.1.0 → 0.2.0');
  assert.equal(out.answer.to, '0.2.0');
  assert.deepEqual(asked, [{ items: { type: 'pack', where: { name: 'recipes' } } }, { parts_of: [m.of('recipes')[0].id] }]);
  await assert.rejects(handler['pack_install.install']({}, ctx), /manifest is the pack file/);
});
