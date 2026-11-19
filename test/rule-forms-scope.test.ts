// Round three's rule forms (feature e_kc462x95, lane e_527zqt9m): a must_link held only on the islands of one pack or
// focus type (on), at least n links (n), an unless that asks each item reached to hold a link (holds.link), and a
// refusal that names what failed it ({missing}). Each: a pack's rule as data in, a verdict out.
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
const feature = { id: 'forms.feature', title: 'Feature', description: 'A feature.', extends: 'work', capabilities: { focus: true }, statuses: { open: ['planned', 'approved'], closed: ['merged'] } };
const overlap = { id: 'forms.overlap', title: 'Overlap', description: 'Two lanes that share files.', extends: 'work' };
const relations = [{ id: 'forms.in_lane', title: 'In lane', description: 'A task is done in a lane.', from: ['task'], to: ['forms.lane'] }];
const pack = (rules: RuleDef[]) => ({ id: 'forms', version: '1.0.0', title: 'Forms', description: 'A pack to try rule forms with.', requires: ['core'], types: [lane, feature, overlap], links: relations, rules }) as unknown as PackFile;

const send = (l: Archipelago, ops: Op[], who = agent) => l.change(who, { reason: 'test', authority: { of: 'agent', basis: 'a test' }, ops }) as Promise<{ status?: string }>;
const refusal = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as Error).message; } return ''; };

async function map(rules: RuleDef[], islands = false) {
  const l = await freshWith(new Registry(packsWith(pack(rules))));
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"'::jsonb) on conflict (key) do update set value = excluded.value`);
  if (islands) await setIslands(l, human, true);
  return l;
}

test('the new words are checked as the pack loads', () => {
  const reg = new Registry(packsWith(pack([])));
  const bad = (rule: RuleDef) => checkRules([rule], reg).join('\n');
  const ok: RuleDef[] = [
    { id: 'a', type: 'task', must_link: { link: 'forms.in_lane', to: 'forms.lane', on: { pack: 'forms' } } },
    { id: 'b', type: 'forms.overlap', must_link: { link: 'depends_on', from: 'forms.lane', n: 2 } },
    { id: 'c', type: 'task', must_link: { link: 'forms.in_lane', on: { focus: 'forms.feature' } } },
    { id: 'd', when: { op: 'update', type: 'forms.feature' }, then: 'refuse', unless: { walk: 'part_of<', type: 'task', holds: { link: { link: 'forms.in_lane', to: 'forms.lane' } } }, say: 'Not in a lane: {missing}' },
  ];
  assert.deepEqual(checkRules(ok, reg), []);
  assert.match(bad({ id: 'x', type: 'task', must_link: { link: 'forms.in_lane', on: {} } }), /must_link.on is \{ pack \} or \{ focus \}/);
  assert.match(bad({ id: 'x', type: 'task', must_link: { link: 'forms.in_lane', on: { focus: 'nothing' } } }), /no type "nothing"/);
  assert.match(bad({ id: 'x', type: 'task', must_link: { link: 'forms.in_lane', n: 0 } }), /must_link.n is a whole number/);
  assert.match(bad({ id: 'x', when: { op: 'update' }, then: 'refuse', unless: { walk: 'part_of<', holds: { link: { link: 'no_such' } } } }), /unless.holds.link.link is a link type/);
});

test('must_link on one pack’s islands: a task needs a lane there, and nowhere else', async () => {
  const l = await map([{ id: 'in_a_lane', type: 'task', must_link: { link: 'forms.in_lane', to: 'forms.lane', on: { pack: 'forms' } }, say: '"{title}" is in a lane ({missing})' }], true);
  const { built, plain } = await make(l, [
    { op: 'create', ref: 'built', type: 'island', title: 'Built', props: { pack: 'forms' } },
    { op: 'create', ref: 'plain', type: 'island', title: 'Plain', props: { pack: 'core' } },
  ] as Op[]);
  const { ln } = await make(l, [{ op: 'create', ref: 'ln', type: 'forms.lane', title: 'Lane', props: { island: built } }] as Op[]);
  assert.match(await refusal(send(l, [{ op: 'create', type: 'task', title: 'Loose', props: { island: built } }] as Op[])), /"Loose" is in a lane \("Loose"\)/);
  assert.equal((await send(l, [{ op: 'create', type: 'task', title: 'Elsewhere', props: { island: plain } }] as Op[])).status, 'applied', 'an island of another pack is not held to it');
  assert.equal((await send(l, [{ op: 'create', ref: 't', type: 'task', title: 'Placed', props: { island: built } }, { op: 'link', type: 'forms.in_lane', from: 't', to: ln }] as Op[])).status, 'applied');
  // Moving a task onto the island is not judged; making one and cutting its lane are.
  const { rows } = await l.db.query<{ id: string }>(`select r.id from relation r join entity e on e.id = r.from_id where e.title = 'Placed' and r.type = 'forms.in_lane'`);
  assert.match(await refusal(send(l, [{ op: 'unlink', relation: rows[0].id }] as Op[])), /"Placed" is in a lane/);
});

test('must_link on a focus’s island: by the focus’s type', async () => {
  const l = await map([{ id: 'in_a_lane', type: 'task', must_link: { link: 'forms.in_lane', on: { focus: 'forms.feature' } } }], true);
  const { f } = await make(l, [{ op: 'create', ref: 'f', type: 'forms.feature', title: 'Feature', props: { focus: true, island: '{f}' } }] as Op[]);
  const { other } = await make(l, [{ op: 'create', ref: 'other', type: 'island', title: 'Other', props: { pack: 'forms' } }] as Op[]);
  assert.match(await refusal(send(l, [{ op: 'create', type: 'task', title: 'On the feature', props: { island: f } }] as Op[])), /"On the feature" needs a forms.in_lane link/);
  assert.equal((await send(l, [{ op: 'create', type: 'task', title: 'Not a focus', props: { island: other } }] as Op[])).status, 'applied');
});

test('must_link with n: an overlap holds both its lanes', async () => {
  const l = await map([{ id: 'both', type: 'forms.overlap', must_link: { link: 'depends_on', from: 'forms.lane', n: 2 } }]);
  const { a, b } = await make(l, [{ op: 'create', ref: 'a', type: 'forms.lane', title: 'A' }, { op: 'create', ref: 'b', type: 'forms.lane', title: 'B' }] as Op[]);
  assert.match(await refusal(send(l, [{ op: 'create', ref: 'o', type: 'forms.overlap', title: 'One lane' }, { op: 'link', type: 'depends_on', from: a, to: 'o' }] as Op[])), /"One lane" needs 2 depends_on links from a forms.lane/);
  assert.match(await refusal(send(l, [{ op: 'create', ref: 'o', type: 'forms.overlap', title: 'Twice' }, { op: 'link', type: 'depends_on', from: a, to: 'o' }, { op: 'link', type: 'depends_on', from: a, to: 'o' }] as Op[])), /needs 2/, 'one lane twice is one');
  assert.equal((await send(l, [{ op: 'create', ref: 'o', type: 'forms.overlap', title: 'Both' }, { op: 'link', type: 'depends_on', from: a, to: 'o' }, { op: 'link', type: 'depends_on', from: b, to: 'o' }] as Op[])).status, 'applied');
  const { rows } = await l.db.query<{ id: string }>(`select r.id from relation r join entity e on e.id = r.to_id where e.title = 'Both' and r.from_id = $1`, [a]);
  assert.match(await refusal(send(l, [{ op: 'unlink', relation: rows[0].id }] as Op[])), /"Both" needs 2/, 'cutting one leaves it short');
});

test('unless with holds.link: every task on the feature is in a lane, and the refusal names those that are not', async () => {
  const say = 'Every task of "{title}" is in a lane first: {missing}';
  const l = await map([{ id: 'placed', when: { op: 'update', type: 'forms.feature', status: { to: 'approved' } }, then: 'refuse', unless: { walk: 'part_of<', type: 'task', holds: { link: { link: 'forms.in_lane', to: 'forms.lane' } } }, say }]);
  const { f, t1, t2, ln } = await make(l, [
    { op: 'create', ref: 'f', type: 'forms.feature', title: 'Feature', status: 'planned' },
    { op: 'create', ref: 'ln', type: 'forms.lane', title: 'Lane' },
    { op: 'create', ref: 't1', type: 'task', title: 'Task one' },
    { op: 'create', ref: 't2', type: 'task', title: 'Task two' },
    { op: 'link', type: 'part_of', from: 'ln', to: 'f' },
    { op: 'link', type: 'part_of', from: 't1', to: 'f' },
    { op: 'link', type: 'part_of', from: 't2', to: 'f' },
    { op: 'link', type: 'forms.in_lane', from: 't1', to: 'ln' },
  ] as Op[]);
  assert.equal(await refusal(send(l, [{ op: 'update', id: f, status: 'approved' }] as Op[], human)), `Change rejected:\n- Every task of "Feature" is in a lane first: "Task two" (todo)`);
  assert.equal((await send(l, [{ op: 'link', type: 'forms.in_lane', from: t2, to: ln }, { op: 'update', id: f, status: 'approved' }] as Op[])).status, 'applied', 'a link in the same change counts');
  assert.ok(t1);
});

test('{missing} names what fails an unless with every and with none', async () => {
  const rules: RuleDef[] = [
    { id: 'merged', when: { op: 'update', type: 'forms.feature', status: { to: 'merged' } }, then: 'refuse', unless: { walk: 'part_of<', type: 'forms.lane', holds: { status: 'merged' } }, say: 'Not merged: {missing}' },
    { id: 'none_open', when: { op: 'update', type: 'forms.feature', status: { to: 'approved' } }, then: 'refuse', unless: { walk: 'part_of<', type: 'forms.lane', holds: { status: 'working' }, count: 'none' }, say: 'Still working: {missing}' },
  ];
  const l = await map(rules);
  const { f } = await make(l, [
    { op: 'create', ref: 'f', type: 'forms.feature', title: 'Feature', status: 'planned' },
    { op: 'create', ref: 'a', type: 'forms.lane', title: 'Lane A', status: 'merged' },
    { op: 'create', ref: 'b', type: 'forms.lane', title: 'Lane B', status: 'working' },
    { op: 'link', type: 'part_of', from: 'a', to: 'f' },
    { op: 'link', type: 'part_of', from: 'b', to: 'f' },
  ] as Op[]);
  assert.match(await refusal(send(l, [{ op: 'update', id: f, status: 'merged' }] as Op[])), /Not merged: "Lane B" \(working\)$/);
  assert.match(await refusal(send(l, [{ op: 'update', id: f, status: 'approved' }] as Op[])), /Still working: "Lane B" \(working\)$/);
});

test('must_link on a pack’s islands holds on the islands of a pack that extends it, and not on one that does not', async () => {
  const study = { id: 'extra.study', title: 'Study', description: 'A feature judged by eye.', extends: 'forms.feature', capabilities: { focus: true } };
  const extra = { id: 'extra', version: '1.0.0', title: 'Extra', description: 'A pack over Forms.', requires: ['type:forms.feature', 'type:forms.lane', 'type:forms.in_lane'], types: [study] } as unknown as PackFile;
  const rule: RuleDef = { id: 'in_a_lane', type: 'task', must_link: { link: 'forms.in_lane', to: 'forms.lane', on: { pack: 'forms' } }, say: '"{title}" is in a lane' };
  const l = await freshWith(new Registry(packsWith(pack([rule]), extra)));
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"'::jsonb) on conflict (key) do update set value = excluded.value`);
  await setIslands(l, human, true);
  const { s, plain } = await make(l, [
    { op: 'create', ref: 's', type: 'extra.study', title: 'A study', props: { focus: true, island: '{s}' } },
    { op: 'create', ref: 'plain', type: 'island', title: 'Plain', props: { pack: 'core' } },
  ] as Op[]);
  assert.match(await refusal(send(l, [{ op: 'create', type: 'task', title: 'Loose screen', props: { island: s } }] as Op[])), /"Loose screen" is in a lane/, 'a study speaks Forms: its tasks are in lanes');
  assert.equal((await send(l, [{ op: 'create', ref: 'ln', type: 'forms.lane', title: 'Lane', props: { island: s } }, { op: 'create', ref: 't', type: 'task', title: 'Placed', props: { island: s } }, { op: 'link', type: 'forms.in_lane', from: 't', to: 'ln' }] as Op[])).status, 'applied');
  assert.equal((await send(l, [{ op: 'create', type: 'task', title: 'Elsewhere', props: { island: plain } }] as Op[])).status, 'applied', 'a pack that extends nothing of Forms is not held to it');
});
