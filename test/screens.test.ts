// Screens as items: the packs ship presets, the owner keeps a version of one on the map, gives it a place in the nav
// or takes it out, and an agent's change to a screen waits for a person.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../src/db.ts';
import { hostFor } from '../src/packtools.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { overlay, type Screen } from '../src/screens.ts';
import { callTool } from '../src/tools.ts';

const human: Actor = { kind: 'human', name: 'test' };
const agent: Actor = { kind: 'agent', name: 'test' };

const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

async function map() {
  const reg = new Registry(join(import.meta.dirname, '..', 'packs'));
  registries.push(reg);
  return new Archipelago(await openDb(), reg);
}

const screens = async (l: Archipelago) => ((await callTool(l, human, 'schema', {})) as { screens: Screen[] }).screens;
const one = async (l: Archipelago, id: string) => (await screens(l)).find((s) => s.id === id);

test('a pack offers a screen for the nav; the owner puts it there, takes it out and puts it back', async () => {
  const l = await map();
  const week = (await one(l, 'time.week'))!;
  assert.deepEqual([week.pack, week.offered, week.nav, week.pieces], ['time', true, undefined, [{ piece: 'page', page: 'time' }]]);
  assert.deepEqual((await one(l, 'time.invoices'))!.on, ['company'], 'a screen on every company');

  const made = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 's', type: 'screen', title: 'Time', status: 'current', props: { preset: 'time.week', nav: 1 } }] })) as { created: Record<string, string> };
  const id = made.created.s;
  assert.deepEqual([(await one(l, 'time.week'))!.nav, (await one(l, 'time.week'))!.item], [1, id]);
  assert.equal((await screens(l)).filter((s) => s.title === 'Time').length, 1, 'the owner’s version stands in for the preset, not beside it');

  await l.change(human, { reason: 'test', ops: [{ op: 'update', id, props: { nav: null } }] });
  assert.equal((await one(l, 'time.week'))!.nav, undefined);
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id, props: { nav: 3 } }] });
  assert.equal((await one(l, 'time.week'))!.nav, 3);

  // Retired, the preset is not shown at all.
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id, status: 'retired' }] });
  assert.equal(await one(l, 'time.week'), undefined);
});

test("an agent's change to a screen waits for a person", async () => {
  const l = await map();
  const asked = (await l.change(agent, { reason: 'test', ops: [{ op: 'create', type: 'screen', title: 'Mine', status: 'current', props: { nav: 1, pieces: [{ piece: 'note', text: 'Hi' }] } }] })) as { status: string };
  assert.equal(asked.status, 'proposed');
  assert.ok(!(await screens(l)).some((s) => s.title === 'Mine'), 'nothing shows until a person approves it');
});

test("the owner's own screen and their version of a preset", () => {
  const presets = [{ id: 'p.a', pack: 'p', title: 'A', on: ['task'], pieces: [{ piece: 'note' as const, text: 'a' }] }];
  const kept = [
    { id: 'e_1', title: 'Mine', is_open: true, props: { nav: 2, pieces: [{ piece: 'note' as const, text: 'm' }] } },
    { id: 'e_2', title: 'A, mine', is_open: true, props: { preset: 'p.a', on: ['project'] } },
    // A version of a preset whose pack is not here, with nothing of its own to draw.
    { id: 'e_3', title: 'Gone', is_open: true, props: { preset: 'q.gone' } },
  ];
  assert.deepEqual(overlay(presets, kept), [
    { id: 'p.a', pack: 'p', title: 'A, mine', on: ['project'], pieces: [{ piece: 'note', text: 'a' }], item: 'e_2' },
    { id: 'e_1', item: 'e_1', title: 'Mine', on: [], pieces: [{ piece: 'note', text: 'm' }], nav: 2 },
  ]);
});
