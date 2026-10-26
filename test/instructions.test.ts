// What agents are told is kept on the map, as how things look is: the core pack ships its instructions as presets, the
// owner's version of one is said in its place, a retired one is not said, and one kept about a repository is said only
// to sessions there, over the workspace's.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDeclared } from '../src/declared.ts';
import { said, filled } from '../src/instructions.ts';
import { hookSessionStart } from '../src/sessions.ts';
import { VIEWS } from '../src/views.ts';
import { fresh, laneSetup, make } from './map.ts';

const presets = [
  { id: 'core.one', type: 'instruction', title: 'One', body: 'Say one.', props: { for: ['session_start'], order: 10 } },
  { id: 'core.two', type: 'instruction', title: 'Two', body: 'Say two.', props: { for: ['session_start', 'working_rules'], order: 20 } },
];
const kept = (id: string, props: Record<string, unknown>, body: string | null, about: string[] = [], is_open = true) => ({ id, title: id, body, is_open, props, about });

test('what is said: presets in order, the owner\'s version in its place, retired not said, a repository\'s over the workspace\'s', () => {
  assert.deepEqual(said(presets, [], 'session_start').map((s) => s.text), ['Say one.', 'Say two.']);
  assert.deepEqual(said(presets, [], 'working_rules').map((s) => s.preset), ['core.two']);
  // The owner's version: its words over the preset's, its order too; one with no words keeps the preset's.
  const mine = said(presets, [kept('e_mine', { preset: 'core.one', order: 30 }, 'Say mine.'), kept('e_bare', { preset: 'core.two' }, '')], 'session_start');
  assert.deepEqual(mine.map((s) => [s.id, s.text, s.preset]), [['e_bare', 'Say two.', 'core.two'], ['e_mine', 'Say mine.', 'core.one']]);
  assert.deepEqual(said(presets, [kept('e_off', { preset: 'core.one' }, null, [], false)], 'session_start').map((s) => s.preset), ['core.two'], 'retired, the preset is not said');
  // The owner's own, about a repository: said only to sessions there, and over the workspace's of the same preset.
  const there = [kept('e_repo', { preset: 'core.one' }, 'Say it here.', ['e_apex']), kept('e_ws', { preset: 'core.one' }, 'Say it everywhere.'), kept('e_new', { for: ['session_start'], order: 5 }, 'New one.')];
  assert.deepEqual(said(presets, there, 'session_start', 'e_apex').map((s) => s.text), ['New one.', 'Say it here.', 'Say two.']);
  assert.deepEqual(said(presets, there, 'session_start', 'e_other').map((s) => s.text), ['New one.', 'Say it everywhere.', 'Say two.']);
  assert.equal(filled('run {run}, {unknown}', { run: 'r_1' }), 'run r_1, {unknown}');
});

test('an instruction preset is checked as a style preset is: its words in body, only the fields its type lets a preset set', async () => {
  const l = await fresh();
  const types = new Map(['instruction', 'style'].map((id) => [id, l.registry.type(id)!]));
  const pack = (styles: unknown[]) => ({ id: 'core', version: '0', title: 'Core', styles }) as never;
  assert.deepEqual(checkDeclared(pack(presets), types, [], false), []);
  const bad = checkDeclared(pack([{ id: 'core.x', type: 'instruction', title: 'X', props: { preset: 'core.one', shape: 'list' } }, { id: 'core.y', type: 'lens', title: 'Y', props: {} }]), types, [], false);
  assert.ok(bad.some((p) => /words in body/.test(p)) && bad.some((p) => /"preset" is not a field/.test(p)) && bad.some((p) => /"shape" is not a field/.test(p)) && bad.some((p) => /a style or an instruction/.test(p)), bad.join('\n'));
});

test('the session-start text is read from the instructions on the map', async () => {
  const l = await fresh();
  await laneSetup(l);
  const text = await hookSessionStart(l, { session_id: 'i1', cwd: 'C:\\code\\Apex' });
  const run = /as run (\S+)\./.exec(text)?.[1];
  assert.match(text, /give it one: how many tokens/);
  assert.ok(text.includes(`report, action tell (run ${run})`), 'the run is filled in');
  assert.match(text, /Keep the map true: when/);
  const repo = /Repository: Apex repo \((e_\w+)\)/.exec(text)![1];
  // The owner's version of one, kept about this repository; another retired for the whole workspace.
  const made = await make(l, [
    { op: 'create', ref: 'v', type: 'instruction', title: 'Map true here', body: 'Here, keep the map truer than true.', props: { preset: 'core.map_true' } },
    { op: 'link', type: 'about', from: 'v', to: repo },
    { op: 'create', ref: 'off', type: 'instruction', title: 'No bumps', status: 'retired', props: { preset: 'core.bumps' } },
  ]);
  const again = await hookSessionStart(l, { session_id: 'i1', cwd: 'C:\\code\\Apex' });
  assert.match(again, /Here, keep the map truer than true\./);
  assert.doesNotMatch(again, /Keep the map true: when|gets in your way/);
  const far = await hookSessionStart(l, { session_id: 'i2', cwd: 'C:\\elsewhere' });
  assert.match(far, /Keep the map true: when/, 'elsewhere the preset is said');
  const view = (await VIEWS.instructions.run(l, { about: repo })) as { said: { id: string; preset?: string }[] };
  assert.deepEqual(view.said.map((s) => s.preset), ['core.estimate', 'core.report_in', 'core.map_true']);
  assert.equal(view.said.at(-1)!.id, made.v);
});
