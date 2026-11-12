// The five capabilities: declared per type with the field each reads, checked when the pack loads, and what the
// kernel computes from instead of from field names.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { checkCapabilities, occurs } from '../packs/loader/kernel/capabilities.ts';
import { Archipelago, type Actor, type Op } from '../packs/write/kernel/pelago.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import * as askviewPack from '../packs/query/kernel/askview.ts';
import { freshWith, human, packsWith } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

/** A view asked by its name, as the view tool asks it. */
const ask = (l: Archipelago, name: string, params: Record<string, unknown> = {}) => askviewPack.askView(kernelContext(l, 'query'), ({ kind: 'human', name: 'test' }) as Parameters<typeof askviewPack.askView>[1], name, params);

const agent: Actor = { kind: 'agent', name: 'test' };

/** A pack of a shop's stock and a room with seats, to try what the shipped packs do not use. */
const SHOP: PackFile = {
  id: 'shop', version: '1', title: 'Shop', requires: ['core'],
  types: [
    { id: 'shop.stock', title: 'Stock', description: '', extends: 'place', fields: { on_hand: { type: 'number' }, reorder_at: { type: 'number' } }, capabilities: { bound: { field: 'on_hand', below: 'reorder_at' } } },
    { id: 'shop.room', title: 'Room', description: '', extends: 'place', fields: { seats: { type: 'number' } }, capabilities: { capacity: { field: 'seats' } } },
    { id: 'shop.order', title: 'Order', description: '', extends: 'task' },
    { id: 'shop.verdict', title: 'Verdict', description: '', extends: 'decision' },
  ],
};

async function map(extra?: PackFile) {
  return freshWith(new Registry(packsWith(extra)));
}

async function make(l: Archipelago, ops: Op[]) {
  const result = await l.change(human, { ops, reason: 'test' });
  assert.equal(result.status, 'applied');
  return (result as { created: Record<string, string> }).created;
}

test('a capability naming a field the type lacks stops its pack from loading', () => {
  const bad = (capabilities: object) => ({ ...SHOP, types: [{ id: 'shop.x', title: 'X', description: '', extends: 'work', fields: { when: { type: 'string' } }, capabilities }] }) as PackFile;
  assert.throws(() => new Registry(packsWith(bad({ bound: { field: 'deadline', limit: 'today' } }))), /bound reads "deadline", which it has no field of/);
  assert.throws(() => new Registry(packsWith(bad({ when: { at: 'when' } }))), /a string, not a date or datetime/);
  assert.throws(() => new Registry(packsWith(bad({ where: { link: 'next_to' } }))), /which is no relation/);
  assert.throws(() => new Registry(packsWith(bad({ colour: {} }))), /"colour" is not a capability/);
  assert.deepEqual(checkCapabilities({ settles: { by: 'word', whose: 'owner' } }, {}, new Set()), []);
  // A question's choices are a list: a json field.
  assert.deepEqual(checkCapabilities({ settles: { by: 'word', choices: 'options' } }, { options: { type: 'json' } }, new Set()), []);
  assert.deepEqual(checkCapabilities({ settles: { by: 'word', choices: 'options' } }, { options: { type: 'string' } }, new Set()), ['settles.choices reads "options", a string, not a json']);
  // The day it was settled on is a day field.
  assert.deepEqual(checkCapabilities({ settles: { by: 'word', on: 'decided_on' } }, { decided_on: { type: 'date' } }, new Set()), []);
  assert.equal(checkCapabilities({ settles: { by: 'word', on: 'decided_on' } }, { decided_on: { type: 'string' } }, new Set()).length, 1);
});

test('every core deadline is a bound, and a flavour inherits its parent capabilities', async () => {
  const l = await map(SHOP);
  assert.deepEqual(l.registry.type('task')!.capabilities.bound, { field: 'due', limit: 'today' });
  assert.deepEqual(l.registry.type('decision')!.capabilities.bound, { field: 'due', limit: 'today' });
  assert.deepEqual(l.registry.type('shop.order')!.capabilities.bound, { field: 'due', limit: 'today' });
  assert.equal(l.registry.type('event')!.capabilities.when?.start, 'at');
  assert.deepEqual(l.registry.having('settles').filter((t) => ['core', 'shop'].includes(l.registry.type(t)!.pack)).sort(), ['decision', 'shop.verdict']);
});

test('at risk is what crosses its bound, whatever the field is called', async () => {
  const l = await map(SHOP);
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const made = await make(l, [
    { op: 'create', ref: 'grant', type: 'decision', title: 'Which flour', props: { due: soon } },
    { op: 'create', ref: 'task', type: 'task', title: 'Send the forms', props: { due: soon } },
    { op: 'create', ref: 'low', type: 'shop.stock', title: 'Flour', props: { on_hand: 3, reorder_at: 10 } },
    { op: 'create', ref: 'ok', type: 'shop.stock', title: 'Salt', props: { on_hand: 30, reorder_at: 10 } },
  ]);
  type Due = { items: { id: string; reasons: { on?: string; limit?: number }[] }[] };
  await callTool(l, { kind: 'human', name: 'test' }, 'init', { name: 'Owner' });
  const due = (await ask(l, 'attention', { person: 'me', reasons: ['due'] })) as Due;
  assert.deepEqual(due.items.filter((r) => r.reasons[0].on).map((r) => r.id).sort(), [made.grant, made.task].sort());
  assert.equal(due.items.find((r) => r.id === made.grant)!.reasons[0].on, soon);
  assert.deepEqual(due.items.filter((r) => r.reasons[0].limit !== undefined).map((r) => r.id), [made.low]);
});

test('a resource holds as many as its capacity, and blocks what needs it once full', async () => {
  const l = await map(SHOP);
  const made = await make(l, [
    { op: 'create', ref: 'room', type: 'shop.room', title: 'Studio', props: { seats: 2 } },
    ...['a', 'b', 'c'].flatMap((t): Op[] => [{ op: 'create', ref: t, type: 'task', title: `Session ${t}` }, { op: 'link', type: 'needs', from: t, to: 'room' }]),
  ]);
  for (const t of ['a', 'b']) assert.equal((await l.claim(human, { resource: made.room, holder: made[t], reason: 'test' })).status, 'claimed');
  await assert.rejects(l.claim(human, { resource: made.room, holder: made.c, reason: 'test' }), /is held by/);
  await callTool(l, { kind: 'human', name: 'test' }, 'init', { name: 'Owner' });
  const blocked = (await ask(l, 'attention', { person: 'me', reasons: ['blocked'] })) as { items: { id: string }[] };
  assert.deepEqual(blocked.items.map((b) => b.id), [made.c]);
  await assert.rejects(l.claim(human, { resource: made.a, holder: made.b, reason: 'test' }), /nothing of its type can be held/);
});

test('settling is held for a person on what declares settles, and by word needs what was chosen', async () => {
  const l = await map(SHOP);
  const made = await make(l, [
    { op: 'create', ref: 'd', type: 'decision', title: 'Which oven' },
    { op: 'create', ref: 'h', type: 'shop.verdict', title: 'Gas or wood' },
  ]);
  for (const id of [made.d, made.h]) assert.equal((await l.change(agent, { reason: 'test', ops: [{ op: 'update', id, status: 'decided' }] })).status, 'proposed');
});

test('a repeat falls on the days its fields say', () => {
  const repeat = { from: 'from', to: 'to', days: 'on' };
  assert.deepEqual(occurs(repeat, { from: '09:00', to: '10:30', on: [3] }, '2026-10-14'), [9, 10.5]);
  assert.equal(occurs(repeat, { from: '09:00', to: '10:30', on: [4] }, '2026-10-14'), undefined);
});
