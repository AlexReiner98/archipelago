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

test("a pack's screen for Home is on it once its pack is used, until the owner takes it off, and can be put back", async () => {
  const l = await map();
  const onHome = async () => (await screens(l)).filter((s) => s.at === 'home').map((s) => s.id);
  assert.deepEqual(await onHome(), ['home'], "a pack's screen waits for the first item of its pack");
  assert.equal((await one(l, 'time.today'))!.idle, true);
  await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', type: 'inquiry.hypothesis', title: 'H', status: 'untested' },
      { op: 'create', type: 'software.release', title: 'R', status: 'upcoming' },
      { op: 'create', type: 'time.entry', title: 'T', status: 'logged', props: { date: '2026-10-17', hours: 1 } },
    ],
  });
  assert.deepEqual(await onHome(), ['home', 'inquiry.undermined', 'software.releases', 'time.today'], "the core pack's first, then each pack's in the order they load");

  const made = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 's', type: 'screen', title: 'Today', status: 'current', props: { preset: 'time.today', home: false } }] })) as { created: Record<string, string> };
  assert.deepEqual(await onHome(), ['home', 'inquiry.undermined', 'software.releases']);
  assert.deepEqual([(await one(l, 'time.today'))!.homeable, (await one(l, 'time.today'))!.at], [true, undefined], 'taken off, it is still listed, to be put back');
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: made.created.s, props: { home: null } }] });
  assert.ok((await onHome()).includes('time.today'));
});

test("the owner's own screen is on Home only when they put it there", () => {
  const kept = [
    { id: 'e_1', title: 'Mine', is_open: true, props: { home: true, pieces: [{ piece: 'note' as const, text: 'm' }] } },
    { id: 'e_2', title: 'Other', is_open: true, props: { nav: 1, pieces: [{ piece: 'note' as const, text: 'o' }] } },
  ];
  assert.deepEqual(overlay([], kept).map((s) => [s.id, s.at, s.homeable]), [['e_1', 'home', undefined], ['e_2', undefined, undefined]]);
});
