// The rule forms that read links (packs/rules/kernel/rule-forms.ts): at most n links into an item, an item that must
// hold a link, and a rule spared unless a walk from the item reaches what holds; and a unique rule on a field the
// islands lay over (e_t2tcbw2t). Each: a pack's rule as data in, a verdict out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRules } from '../packs/loader/kernel/rule-check.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import type { RuleDef } from '../packs/rules/kernel/rules.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import type { Op } from '../packs/write/kernel/pelago-types.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

const lane = { id: 'forms.lane', title: 'Lane', description: 'A lane.', extends: 'work', statuses: { open: ['planned', 'working', 'handed'], closed: ['merged'] } };
const feature = { id: 'forms.feature', title: 'Feature', description: 'A feature.', extends: 'work', statuses: { open: ['planned', 'approved'], closed: ['merged'] } };
const integration = { id: 'forms.integration', title: 'Integration', description: 'One per feature.', extends: 'work' };
const RULES: RuleDef[] = [
  { id: 'one_holder', type: 'forms.lane', at_most: { link: 'depends_on', n: 1 } },
  { id: 'in_a_feature', type: 'forms.lane', must_link: { link: 'part_of', to: 'forms.feature' }, say: '"{title}" is part of a feature' },
  { id: 'merged_when_handed', when: { op: 'update', type: 'forms.feature', status: { to: 'merged' } }, then: 'refuse', unless: { walk: 'part_of<', type: 'forms.lane', holds: { status: 'handed' } }, say: 'Every lane of "{title}" is handed first' },
  { id: 'one_integration', unique: ['island'], type: 'forms.integration' },
];
const pack = (rules: RuleDef[] = RULES) => ({ id: 'forms', version: '1.0.0', title: 'Forms', description: 'A pack to try rule forms with.', requires: ['core'], types: [lane, feature, integration], rules }) as unknown as PackFile;

const send = (l: Archipelago, ops: Op[], who = agent) => l.change(who, { reason: 'test', authority: { of: 'agent', basis: 'a test' }, ops }) as Promise<{ status?: string; created?: Record<string, string> }>;
const refusal = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as Error).message; } return ''; };

async function map() {
  const l = await freshWith(new Registry(packsWith(pack())));
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"'::jsonb) on conflict (key) do update set value = excluded.value`);
  const made = await make(l, [
    { op: 'create', ref: 'f', type: 'forms.feature', title: 'Feature', status: 'approved' },
    { op: 'create', ref: 'l1', type: 'forms.lane', title: 'Lane one', status: 'handed' },
    { op: 'create', ref: 'l2', type: 'forms.lane', title: 'Lane two', status: 'working' },
    { op: 'link', type: 'part_of', from: 'l1', to: 'f' },
    { op: 'link', type: 'part_of', from: 'l2', to: 'f' },
    { op: 'create', ref: 'a', type: 'task', title: 'Task A' },
    { op: 'create', ref: 'b', type: 'task', title: 'Task B' },
  ] as Op[]);
  return { l, ...made } as { l: Archipelago } & Record<string, string>;
}

test('each form is checked as its pack loads', () => {
  const reg = new Registry(packsWith(pack()));
  assert.deepEqual(checkRules(RULES, reg), [], 'the forms as written hold');
  const bad = (rule: RuleDef) => checkRules([rule], reg).join('\n');
  assert.match(bad({ id: 'x', at_most: { link: 'depends_on', n: 0 }, type: 'forms.lane' }), /at least 1/);
  assert.match(bad({ id: 'x', at_most: { link: 'no_such', n: 1 }, type: 'forms.lane' }), /link type the packs define/);
  assert.match(bad({ id: 'x', at_most: { link: 'depends_on', n: 1 } }), /type it holds of/);
  assert.match(bad({ id: 'x', at_most: { link: 'depends_on', n: 1 }, type: 'forms.lane', when: { actor: 'agent' } }), /takes no when/);
  assert.match(bad({ id: 'x', must_link: { link: 'part_of', to: 'forms.feature', from: 'task' }, type: 'forms.lane' }), /not both/);
  assert.match(bad({ id: 'x', must_link: { link: 'part_of', to: 'nothing' }, type: 'forms.lane' }), /no type "nothing"/);
  assert.match(bad({ id: 'x', when: { op: 'update' }, then: 'refuse', unless: { walk: 'part_of<>', holds: { status: 'done' } } }), /unless.walk/);
  assert.match(bad({ id: 'x', when: { op: 'update' }, then: 'refuse', unless: { walk: 'part_of<', steps: 9, holds: { status: 'done' } } }), /steps is 1 to 5/);
  assert.match(bad({ id: 'x', when: { op: 'update' }, then: 'refuse', unless: { walk: 'part_of<', holds: {} } }), /a status or fields/);
  assert.match(bad({ id: 'x', when: { op: 'update' }, then: 'spare', spares: ['x'], unless: { walk: 'part_of<', holds: { status: 'done' } } }), /holds or refuses/);
});

test('a unique rule on island loads before the map has islands, and holds once it does (e_t2tcbw2t)', async () => {
  // The registry is first made with islands off: a rule on island refused it there before the check read fields as laid over.
  const l = await freshWith(new Registry(packsWith(pack())));
  await setIslands(l, human, true);
  const { home } = await make(l, [{ op: 'create', ref: 'home', type: 'island', title: 'Home', props: { pack: 'forms' } }] as Op[]);
  await make(l, [{ op: 'create', type: 'forms.integration', title: 'First', props: { island: home } }] as Op[]);
  assert.match(await refusal(send(l, [{ op: 'create', type: 'forms.integration', title: 'Second', props: { island: home } }] as Op[])), /already has island/);
});

test('at most n links into an item: past n is refused, naming who holds it; a closed holder holds nothing', async () => {
  const { l, l1, a, b } = await map();
  assert.equal((await send(l, [{ op: 'link', type: 'depends_on', from: a, to: l1 }] as Op[])).status, 'applied');
  const said = await refusal(send(l, [{ op: 'link', type: 'depends_on', from: b, to: l1 }] as Op[], human));
  assert.match(said, /"Lane one" takes at most 1 depends_on: Task A holds it \(heard \d{4}-\d\d-\d\d/, 'whoever sends it, a person too');
  await make(l, [{ op: 'update', id: a, status: 'done' }] as Op[]);
  assert.equal((await send(l, [{ op: 'link', type: 'depends_on', from: b, to: l1 }] as Op[])).status, 'applied', 'a finished holder no longer holds it');
});

test('at most n counts the links a change adds and takes away', async () => {
  const { l, l2, a, b } = await map();
  assert.match(await refusal(send(l, [{ op: 'link', type: 'depends_on', from: a, to: l2 }, { op: 'link', type: 'depends_on', from: b, to: l2 }] as Op[])), /takes at most 1/);
  await send(l, [{ op: 'link', type: 'depends_on', from: a, to: l2 }] as Op[]);
  const { rows } = await l.db.query<{ id: string }>(`select id from relation where from_id = $1 and to_id = $2 and valid_to is null`, [a, l2]);
  assert.equal((await send(l, [{ op: 'unlink', relation: rows[0].id }, { op: 'link', type: 'depends_on', from: b, to: l2 }] as Op[])).status, 'applied', 'handed over in one change');
});

test('an item must hold a link: made without it, or left without it, is refused', async () => {
  const { l, f, a, l2 } = await map();
  assert.match(await refusal(send(l, [{ op: 'create', type: 'forms.lane', title: 'Stray' }] as Op[])), /"Stray" is part of a feature/);
  assert.match(await refusal(send(l, [{ op: 'create', ref: 'x', type: 'forms.lane', title: 'Under a task' }, { op: 'link', type: 'part_of', from: 'x', to: a }] as Op[])), /is part of a feature/, 'the link goes to an item of the type it names');
  assert.equal((await send(l, [{ op: 'create', ref: 'x', type: 'forms.lane', title: 'Placed' }, { op: 'link', type: 'part_of', from: 'x', to: f }] as Op[])).status, 'applied', 'the create and its link go together');
  const { rows } = await l.db.query<{ id: string }>(`select id from relation where from_id = $1 and type = 'part_of' and valid_to is null`, [l2]);
  assert.match(await refusal(send(l, [{ op: 'unlink', relation: rows[0].id }] as Op[])), /"Lane two" is part of a feature/);
  assert.equal((await send(l, [{ op: 'unlink', relation: rows[0].id }, { op: 'archive', id: l2 }] as Op[])).status, 'applied', 'an item archived with it needs nothing');
});

test('a rule unless a walk reaches what holds: refused until every lane is handed, the change’s own updates read', async () => {
  const { l, f, l2 } = await map();
  assert.match(await refusal(send(l, [{ op: 'update', id: f, status: 'merged' }] as Op[])), /Every lane of "Feature" is handed first/);
  assert.equal((await send(l, [{ op: 'update', id: l2, status: 'handed' }, { op: 'update', id: f, status: 'merged' }] as Op[])).status, 'applied');
});

test('unless with some, and fields', async () => {
  const some: RuleDef = { id: 'started', when: { op: 'update', type: 'forms.feature', status: { to: 'merged' } }, then: 'refuse', unless: { walk: 'part_of<', holds: { fields: { seen_working: true } }, count: 'some' }, say: 'none checked' };
  const l = await freshWith(new Registry(packsWith(pack([some]))));
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"'::jsonb) on conflict (key) do update set value = excluded.value`);
  const { f, x } = await make(l, [
    { op: 'create', ref: 'f', type: 'forms.feature', title: 'F', status: 'approved' },
    { op: 'create', ref: 'x', type: 'task', title: 'X' },
    { op: 'link', type: 'part_of', from: 'x', to: 'f' },
  ] as Op[]);
  assert.match(await refusal(send(l, [{ op: 'update', id: f, status: 'merged' }] as Op[])), /none checked/);
  await make(l, [{ op: 'update', id: x, props: { seen_working: true } }] as Op[]);
  assert.equal((await send(l, [{ op: 'update', id: f, status: 'merged' }] as Op[])).status, 'applied');
});
