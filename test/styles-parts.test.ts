// The styles pack's parts (packs/styles/parts/) and the usage pack's limits card, run as their worker runs them: what
// each is handed, marks the host's check takes, and the action each press sends; and the styles pack's handler, input
// in, ops out (packs/styles/kernel/part-acts.ts, run in-process as an internal pack's actions are).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks as checkAny } from '../packs/walls/page/part-check.js';
// @ts-expect-error: plain modules of the pack, with no types of their own.
import presets from '../packs/styles/parts/presets/index.js';
// @ts-expect-error: as above
import themes from '../packs/styles/parts/themes/index.js';
// @ts-expect-error: as above
import layoutSwitch from '../packs/styles/parts/layout-switch/index.js';
import { deleteLayout, deleteLayoutAct, use } from '../packs/styles/kernel/part-acts.ts';
// @ts-expect-error: as above
import limits from '../packs/usage/parts/limits/index.js';

const manifest = (pack: string) => JSON.parse(readFileSync(new URL(`../packs/${pack}/pack.json`, import.meta.url), 'utf8'));
const kindsOf = (pack: string, id: string) => manifest(pack).parts.find((p: { id: string }) => p.id === id).marks;
const checker = (pack: string, id: string) => (marks: unknown) => checkAny(marks, { kinds: kindsOf(pack, id) });
const tools = (sent: unknown[], went: unknown[] = []) => ({ marks: () => {}, go: (a: unknown) => went.push(a), act: async (action: string, params: unknown) => (sent.push([action, params]), { status: 'applied' }) });

const STYLES = [
  { id: 'core.house', pack: 'core', title: 'House', props: { theme: { light: { paper: '#fff' } } } },
  { id: 'core.tasks', pack: 'core', title: 'Tasks', on: ['task'], props: { size: 2 } },
  { id: 'flow.kept', pack: 'flow', title: 'Kept', props: {}, item: 'e_kept0001' },
  { id: 'flow.gone', pack: 'flow', title: 'Gone', props: {}, item: 'e_gone0001', retired: true },
  { id: 'core.dusk', pack: 'core', title: 'Dusk', over: 'chosen', props: { theme: {} } },
  { id: 'core.sea', pack: 'core', title: 'Sea', over: 'chosen', props: { theme: {} }, item: 'e_sea00001' },
];
const words = { types: { task: { title: 'Job' } }, links: {} };

test('the presets card lists the presets by pack, and Change and Use again send the pack’s actions', async () => {
  const check = checker('styles', 'styles.presets');
  const sent: unknown[] = [];
  const part = presets({ item: null, views: { style_presets: { styles: STYLES } }, words, piece: { section: 'packs' } }, tools(sent));
  check(part.marks);
  const said = JSON.stringify(part.marks);
  assert.match(said, /on Job/, 'what a preset is on, by the map’s words');
  assert.doesNotMatch(said, /Dusk/, 'a theme is chosen on its own card');
  assert.match(said, /"item":"e_kept0001"/, 'the owner’s version opens with a press');
  check(await part.on({ name: 'press', key: 'change:core.tasks' }));
  check(await part.on({ name: 'press', key: 'again:flow.gone' }));
  assert.deepEqual(sent, [['styles.use', { preset: 'core.tasks' }], ['styles.use', { preset: 'flow.gone' }]]);
  assert.deepEqual(part.update({ views: { style_presets: { styles: STYLES } }, piece: { section: 'map' } }), ['box', {}], 'nothing in another section');
});

test('the theme card asks before it keeps a theme, retiring the one kept, and lets it go for the house colours', async () => {
  const check = checker('styles', 'styles.themes');
  const sent: unknown[] = [];
  const part = themes({ views: { style_presets: { styles: STYLES } }, piece: { section: 'map' } }, tools(sent));
  check(part.marks);
  assert.match(JSON.stringify(part.marks), /Sea ✓/, 'the kept theme is marked');
  const asking = await part.on({ name: 'press', key: 'pick:core.dusk' });
  check(asking);
  assert.match(JSON.stringify(asking), /Dusk for the whole workspace\?/);
  check(await part.on({ name: 'press', key: 'keep' }));
  check(await part.on({ name: 'press', key: 'pick:house' }));
  check(await part.on({ name: 'press', key: 'house' }));
  assert.deepEqual(sent, [
    ['styles.use', { preset: 'core.dusk' }],
    ['styles.use', { preset: 'core.sea', use: false }],
  ]);
});

test('the layout switch offers the packs’ layouts and the kept ones, moves the page, and deletes a kept one', async () => {
  const check = checker('styles', 'styles.layout_switch');
  const sent: unknown[] = [], went: unknown[] = [];
  const layouts = { shapes: [{ shape: 'flow', title: 'Flow' }, { shape: 'grid', title: 'Grid' }], kept: [{ id: 'e_lay00001', title: 'Mine', views: 2 }] };
  const query = { filter: { find: ['task'] } };
  const part = layoutSwitch({ views: { layouts }, address: { query, layout: { style: 'e_lay00001' } } }, tools(sent, went));
  check(part.marks);
  const pick = JSON.stringify(part.marks);
  assert.match(pick, /"values":\["","shape:grid","style:e_lay00001"\]/);
  assert.match(pick, /"names":\["Flow","Grid","Mine"\]/, 'the first layout shipped is the default');
  assert.match(pick, /"value":"style:e_lay00001"/);
  await part.on({ name: 'pick', key: 'layout', value: 'shape:grid' });
  assert.deepEqual(went.pop(), { query, layout: { shape: 'grid' } });
  const asking = await part.on({ name: 'press', key: 'ask' });
  check(asking);
  assert.match(JSON.stringify(asking), /2 views draw in it/);
  check(await part.on({ name: 'press', key: 'delete' }));
  assert.deepEqual(sent, [['styles.delete_layout', { layout: 'e_lay00001' }]]);
  assert.deepEqual(went.pop(), { query, layout: {} }, 'then the default');
  check(part.update({ views: { layouts }, address: { query: null, layout: {} } }));
});

test('the styles pack’s actions answer with the ops each action makes, and touches nothing but a style or layout', async () => {
  const presets = STYLES.map(({ item: _i, retired: _r, ...p }) => p) as Parameters<typeof use>[2];
  const versions = [
    { id: 'e_kept0001', title: 'Kept', is_open: true, props: { preset: 'flow.kept' } },
    { id: 'e_gone0001', title: 'Gone', is_open: false, props: { preset: 'flow.gone' } },
    { id: 'e_sea00001', title: 'Sea', is_open: true, props: { preset: 'core.sea' } },
  ];
  assert.deepEqual(use('core.tasks', true, presets, versions).ops, [{ op: 'create', ref: 'mine', type: 'style', title: 'Tasks', status: 'current', props: { size: 2, on: ['task'], preset: 'core.tasks' } }], 'the preset as it ships, read on the server');
  assert.deepEqual(use('flow.gone', true, presets, versions).ops, [{ op: 'update', id: 'e_gone0001', status: 'current' }]);
  assert.deepEqual(use('core.sea', false, presets, versions).ops, [{ op: 'update', id: 'e_sea00001', status: 'retired' }]);
  assert.deepEqual(use('flow.kept', true, presets, versions).ops, [], 'already used');
  assert.deepEqual(use('core.dusk', true, presets, versions).ops.map((o) => [o.op, o.id]), [['update', 'e_sea00001'], ['create', undefined]], 'a theme chosen retires the one kept');
  assert.throws(() => use('core.none', true, presets, versions), /not a style preset/);
  assert.deepEqual(deleteLayout({ id: 'e_lay00001', type: 'layout', title: 'Mine' }).ops, [{ op: 'archive', id: 'e_lay00001' }]);
  assert.throws(() => deleteLayout(undefined), /not a layout/);
  const ctx = { reads: async () => [{ id: 'e_task0001', type: 'task', title: 'A task' }], registry: { isA: (t: string, of: string) => t === of } };
  await assert.rejects(deleteLayoutAct(ctx as never, { layout: 'e_task0001' }), /not a layout/, 'what is read must be a layout');
  const { actions, kernel } = manifest('styles');
  for (const a of actions) assert.ok(kernel.provides[`act.${a.verb}.${a.id.slice('styles.'.length)}`], `${a.id} runs as the service its verb and name provide`);
});

test('the limits card shows each limit the server sets, near ones first said, and nothing where none is set', () => {
  const check = checker('usage', 'usage.limits');
  const usage = { items: [
    { id: 'use:storage', title: 'Storage', use: { as: 'limit', shown: '212 MB', of: 500, of_shown: '500 MB', near: false } },
    { id: 'use:members', title: 'Members', use: { as: 'limit', shown: '9', of: 10, of_shown: '10', near: true } },
    { id: 'use:looks', title: 'Looks this hour', use: { as: 'limit', shown: '3' } },
  ] };
  const part = limits({ views: { usage }, piece: { section: 'people' } });
  check(part.marks);
  const said = JSON.stringify(part.marks);
  assert.match(said, /near the limit: Members/);
  assert.match(said, /212 MB of 500 MB/);
  assert.doesNotMatch(said, /Looks this hour/, 'a use with no limit is not a row');
  assert.deepEqual(part.update({ views: { usage: { items: [usage.items[2]] } }, piece: { section: 'people' } }), ['box', {}]);
});
