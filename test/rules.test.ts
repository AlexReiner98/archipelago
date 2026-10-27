// Rules as data: declared in pack files, enforced on what is written whichever way it came, and only tightening.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor, type Op } from '../src/pelago.ts';
import { Registry, type PackFile } from '../src/packs.ts';

const human: Actor = { kind: 'human', name: 'test' };
const agent: Actor = { kind: 'agent', name: 'test' };

/** A shop's orders: big ones wait for a person, a paid one needs its date, numbers are not reused. */
const SHOP: PackFile = {
  id: 'shop', version: '1', title: 'Shop', requires: ['core'],
  types: [{
    id: 'shop.order', title: 'Order', description: '', extends: 'work',
    statuses: { open: ['open'], closed: ['paid', 'void'] },
    fields: { total: { type: 'number' }, number: { type: 'string' }, paid_on: { type: 'date' } },
  }],
  rules: [
    { id: 'big', when: { actor: 'agent', op: ['create', 'update'], type: 'shop.order', compare: 'total > 500' }, then: 'hold' },
    { id: 'paid', when: { op: 'update', type: 'shop.order', status: { to: 'closed' } }, then: { require: ['paid_on'] } },
    { id: 'void', when: { actor: 'agent', kind: 'work', status: { to: 'void' } }, then: 'refuse', say: 'Only a person voids "{title}".' },
    { unique: ['number'], type: 'shop.order' },
  ],
};

async function map(packs: PackFile[] = [SHOP]) {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-rules-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  for (const pack of packs) {
    mkdirSync(join(dir, pack.id));
    writeFileSync(join(dir, pack.id, 'pack.json'), JSON.stringify(pack));
  }
  return new Archipelago(await openDb(), new Registry(dir), { create: 'auto', update: 'auto', link: 'auto' });
}

const change = (l: Archipelago, actor: Actor, ops: Op[]) => l.change(actor, { reason: 'test', ops });

test('a rule holds what crosses a value, for agents only', async () => {
  const l = await map();
  assert.equal((await change(l, agent, [{ op: 'create', type: 'shop.order', title: 'Flour', props: { total: 80 } }])).status, 'applied');
  assert.equal((await change(l, agent, [{ op: 'create', type: 'shop.order', title: 'Oven', props: { total: 900 } }])).status, 'proposed');
  assert.equal((await change(l, human, [{ op: 'create', type: 'shop.order', title: 'Mixer', props: { total: 900 } }])).status, 'applied');
});

test('a rule requires fields, refuses by kind, and keeps values unique within a type', async () => {
  const l = await map();
  const made = (await change(l, human, [{ op: 'create', ref: 'o', type: 'shop.order', title: 'Flour', props: { number: 'A-1' } }])) as { created: Record<string, string> };
  const o = made.created.o;
  await assert.rejects(change(l, human, [{ op: 'update', id: o, status: 'paid' }]), /needs paid_on/);
  assert.equal((await change(l, human, [{ op: 'update', id: o, status: 'paid', props: { paid_on: '2026-10-16' } }])).status, 'applied');
  await assert.rejects(change(l, agent, [{ op: 'update', id: o, status: 'void' }]), /Only a person voids "Flour"/);
  await assert.rejects(change(l, human, [{ op: 'create', type: 'shop.order', title: 'Salt', props: { number: 'A-1' } }]), /already has number "A-1"/);
  assert.equal((await change(l, human, [{ op: 'update', id: o, props: { number: 'A-1' } }])).status, 'applied', 'an item does not clash with itself');
});

test('a pack without its rules loosens what they added, and nothing else', async () => {
  const l = await map([{ ...SHOP, rules: [] }]);
  assert.equal((await change(l, agent, [{ op: 'create', type: 'shop.order', title: 'Oven', props: { total: 900 } }])).status, 'applied');
  assert.equal((await change(l, agent, [{ op: 'create', type: 'style', title: 'Loud', props: { code: 'export default () => {}' } }])).status, 'proposed', "core's rules stand");
});

test('a rule that names what is not there stops its pack from loading', async () => {
  await assert.rejects(map([{ ...SHOP, rules: [{ when: { type: 'shop.nothing' }, then: 'hold' }] }]), /no type "shop.nothing"/);
  await assert.rejects(map([{ ...SHOP, rules: [{ when: { compare: 'total is big' }, then: 'hold' }] }]), /compare reads like/);
  await assert.rejects(map([{ ...SHOP, rules: [{ unique: ['colour'], type: 'shop.order' }] }]), /has no field "colour"/);
});

test('a held change names the rule that held it, in its answer and on the proposal', async () => {
  const l = await map();
  const held = (await change(l, agent, [{ op: 'create', type: 'shop.order', title: 'Oven', props: { total: 900 } }])) as { proposal: string; held_by: { rule: string; pack: string } };
  assert.deepEqual([held.held_by.pack, held.held_by.rule], ['shop', 'big']);
  const [kept] = (await l.db.query<{ held_by: { rule: string } }>(`select held_by from proposal where id = $1`, [held.proposal])).rows;
  assert.equal(kept.held_by.rule, 'big');
  // Under review, the most particular rule is named: the one about code, not the one every agent's change is under.
  const strict = new Archipelago(l.db, l.registry);
  const code = (await change(strict, agent, [{ op: 'create', type: 'style', title: 'Loud', props: { code: 'export default () => {}' } }])) as { held_by: { rule: string } };
  assert.equal(code.held_by.rule, 'code_runs');
  const plain = (await change(strict, agent, [{ op: 'create', type: 'task', title: 'Plain' }])) as { held_by: { rule: string } };
  assert.equal(plain.held_by.rule, 'agent_changes');
});

test('a setting lifts only a rule its pack declared liftable', async () => {
  await assert.rejects(map([{ ...SHOP, rules: [{ when: { type: 'shop.order' }, then: 'hold', lifted: 'agent_shopping' }] }]), /lifted is one of/);
  const shop = await map();
  const l = new Archipelago(shop.db, shop.registry);
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"'::jsonb)`);
  assert.equal((await change(l, agent, [{ op: 'create', type: 'task', title: 'Plain' }])).status, 'applied', 'agent_changes lifts core’s agent_changes');
  assert.equal((await change(l, agent, [{ op: 'create', type: 'shop.order', title: 'Oven', props: { total: 900 } }])).status, 'proposed', 'and not a rule declared without a lift');
});

test('a drawing asks in data: inside the types its style writes it applies, anything else waits for the person', async () => {
  const l = await map();
  const made = (await change(l, human, [
    { op: 'create', ref: 's', type: 'style', title: 'Shop drawing', props: { code: 'export default () => {}', writes: ['shop.order'] } },
    { op: 'create', ref: 'plain', type: 'style', title: 'No code' },
    { op: 'create', ref: 'task', type: 'work.task', title: 'Count stock' },
  ])) as { created: Record<string, string> };
  const { s, plain, task } = made.created;
  const asked = (ops: Op[], actor = human, drawing = s) => l.change(actor, { reason: 'Saved in the drawing', ops, drawing });
  const kept = (await asked([{ op: 'create', ref: 'o', type: 'shop.order', title: 'Flour', props: { total: 80 } }])) as { status: string; created: Record<string, string> };
  assert.equal(kept.status, 'applied', 'a type its style writes');
  assert.equal((await asked([{ op: 'update', id: kept.created.o, props: { total: 90 } }])).status, 'applied');
  assert.equal((await asked([{ op: 'archive', id: kept.created.o }])).status, 'applied');
  const held = (await asked([{ op: 'update', id: task, title: 'Count it all' }])) as { status: string; held_by?: { rule: string } };
  assert.deepEqual([held.status, held.held_by?.rule], ['proposed', 'drawing_reach'], 'a type it does not write waits, though a person sent it');
  assert.equal(((await asked([{ op: 'link', type: 'relates_to', from: task, to: s }])) as { status: string }).status, 'proposed', 'a link waits');
  assert.equal(((await asked([{ op: 'update', id: s, props: { writes: ['work.task'] } }])) as { held_by?: { rule: string } }).held_by?.rule !== undefined, true, 'what a drawing may write is not its own to widen');
  await assert.rejects(asked([{ op: 'merge', keep: task, drop: plain }]), /may ask to create/);
  await assert.rejects(asked([{ op: 'create', type: 'shop.order', title: 'Oil' }], human, plain), /no style with code/);
  await assert.rejects(asked([{ op: 'create', type: 'shop.order', title: 'Oil' }], agent), /sent by the page/);
  assert.equal((await change(l, human, [{ op: 'update', id: task, title: 'Count it all' }])).status, 'applied', 'the person, not through a drawing, waits for nobody');
});
