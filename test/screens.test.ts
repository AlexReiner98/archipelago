// Screens as items: the packs ship presets, the owner keeps a version of one on the map, gives it a place in the nav
// or takes it out, and an agent's change to a screen waits for a person.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../packs/database/kernel/db.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { Archipelago, type Actor } from '../packs/write/kernel/pelago.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { overlay, type Screen } from '../packs/styles/kernel/screens.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { human, packsWith } from './map.ts';

const agent: Actor = { kind: 'agent', name: 'test' };

const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

/** A pack that offers one screen for the nav, to try what the owner does with it. */
const WEEK: PackFile = { id: 'tp', version: '1', title: 'Week', requires: ['core'], views: [{ form: 'screen', id: 'tp.week', title: 'Week', nav: true, pieces: [{ piece: 'note', text: 'A week' }] }] } as PackFile;

async function map(extra?: PackFile) {
  const reg = new Registry(extra ? packsWith(extra) : join(import.meta.dirname, '..', 'packs'));
  registries.push(reg);
  return new Archipelago(await openDb(), reg);
}

const screens = async (l: Archipelago) => ((await callTool(l, human, 'schema', {})) as { screens: Screen[] }).screens;
const one = async (l: Archipelago, id: string) => (await screens(l)).find((s) => s.id === id);

test('a pack offers a screen for the nav; the owner puts it there, takes it out and puts it back', async () => {
  const l = await map(WEEK);
  const week = (await one(l, 'tp.week'))!;
  assert.deepEqual([week.pack, week.offered, week.nav, week.pieces], ['tp', true, undefined, [{ piece: 'note', text: 'A week' }]]);

  const made = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 's', type: 'screen', title: 'My week', status: 'current', props: { preset: 'tp.week', nav: 1 } }] })) as { created: Record<string, string> };
  const id = made.created.s;
  assert.deepEqual([(await one(l, 'tp.week'))!.nav, (await one(l, 'tp.week'))!.item], [1, id]);
  assert.equal((await screens(l)).filter((s) => s.title === 'My week').length, 1, 'the owner’s version stands in for the preset, not beside it');

  await l.change(human, { reason: 'test', ops: [{ op: 'update', id, props: { nav: null } }] });
  assert.equal((await one(l, 'tp.week'))!.nav, undefined);
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id, props: { nav: 3 } }] });
  assert.equal((await one(l, 'tp.week'))!.nav, 3);

  // Retired, the preset is not shown at all.
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id, status: 'retired' }] });
  assert.equal(await one(l, 'tp.week'), undefined);
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
    { id: 'e_2', title: 'A, mine', is_open: true, props: { preset: 'p.a', on: ['finding'] } },
    // A version of a preset whose pack is not here, with nothing of its own to draw.
    { id: 'e_3', title: 'Gone', is_open: true, props: { preset: 'q.gone' } },
  ];
  assert.deepEqual(overlay(presets, kept), [
    { id: 'p.a', pack: 'p', title: 'A, mine', on: ['finding'], pieces: [{ piece: 'note', text: 'a' }], item: 'e_2' },
    { id: 'e_1', item: 'e_1', title: 'Mine', on: [], pieces: [{ piece: 'note', text: 'm' }], nav: 2 },
  ]);
});

test("a screen is on Home only once the owner puts it there", async () => {
  const l = await map();
  const onHome = async () => (await screens(l)).filter((s) => s.at === 'home').map((s) => s.title);
  assert.deepEqual(await onHome(), ['For you'], "Home is the owner's move: the core pack's screen alone");
  const made = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 's', type: 'screen', title: 'Mine', status: 'current', props: { pieces: [{ piece: 'note', text: 'Hi' }], home: true } }] })) as { created: Record<string, string> };
  assert.deepEqual(await onHome(), ['For you', 'Mine'], 'put on Home by the owner');
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: made.created.s, props: { home: false } }] });
  assert.deepEqual(await onHome(), ['For you'], 'and taken off again');
});

test("the owner's own screen is on Home only when they put it there", () => {
  const kept = [
    { id: 'e_1', title: 'Mine', is_open: true, props: { home: true, pieces: [{ piece: 'note' as const, text: 'm' }] } },
    { id: 'e_2', title: 'Other', is_open: true, props: { nav: 1, pieces: [{ piece: 'note' as const, text: 'o' }] } },
  ];
  assert.deepEqual(overlay([], kept).map((s) => [s.id, s.at, s.homeable]), [['e_1', 'home', undefined], ['e_2', undefined, undefined]]);
});
