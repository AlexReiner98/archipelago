// The styles pack run without a database: a context whose reads answer from a few styles in memory. The layers of a
// style, a page's style and its person, the screens overlaid, and the two moves planned. Against a real map:
// test/view-style.test.ts, test/page-style.test.ts, test/theme-model.test.ts, test/screens.test.ts,
// test/style-move.test.ts and test/layout-move.test.ts, through the shims in src/.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { pageStyle, styleFor } from './styles.ts';
import { withScreens } from './screens.ts';
import { moveStyles, planStyles } from './style-move.ts';
import { LAYOUTS_MOVED, moveLayouts, planLayouts } from './layout-move.ts';
import { cssProblem } from './page-css.ts';

const preset = { id: 'core.plain', title: 'Plain', props: { shape: 'flow', lengths: { gap: 8 } } };

function context(answers: Record<string, unknown>): KernelContext {
  const types = new Map([
    ['task', { id: 'task', pack: 'core', lineage: ['task'], capabilities: {} }],
    ['layout', { id: 'layout', pack: 'core', lineage: ['layout'], capabilities: {} }],
  ]);
  const registry = {
    types, relations: new Map(), packs: [{ id: 'core', styles: [preset], layouts: [{ id: 'core.map' }] }], rules: [], trees: new Map(),
    type: (id: string) => types.get(id), isA: (t: string, k: string) => t === k, family: (t: string) => [t], relationFamily: (...r: string[]) => r,
    having: () => [], ancestry: (t: string) => ({ root: t, starter: t }), capacity: () => undefined,
  };
  const reads = async (q: Record<string, unknown>) => {
    const key = Object.keys(q)[0];
    if (key in answers) return typeof answers[key] === 'function' ? (answers[key] as (v: unknown) => unknown)(q[key]) : answers[key];
    throw new Error(`not read here: ${key}`);
  };
  return { pack: { id: 'styles', version: '0', hash: '' }, workspace: 'w', reads, registry } as unknown as KernelContext;
}

test('a style kept about the item lies over the preset, and the view over that', async () => {
  const ctx = context({ versions: [] });
  const kept = [{ id: 's1', title: 'Mine', props: { shape: 'grid', lengths: { pad: 2 } }, about: ['t1'] }];
  const { style, used } = await styleFor(ctx, kept, { hub: { id: 't1', type: 'task' }, own: { lengths: { gap: 3 } } });
  assert.equal(style.shape, 'grid');
  assert.deepEqual(style.lengths, { gap: 3, pad: 2 }, 'lengths merged name by name, the nearest last');
  assert.deepEqual(used.map((u) => u.id), ['core.plain', 's1', 'view']);
});

test("the owner's retired version of a preset leaves it out", async () => {
  const ctx = context({ versions: [{ id: 'v1', title: 'Gone', is_open: false, props: { preset: 'core.plain' } }] });
  const { used } = await styleFor(ctx, [], {});
  assert.deepEqual(used, []);
});

test('a page is drawn for the person it is read by, and their colours lie over everything', async () => {
  const ctx = context({
    versions: [], ids: [{ id: 't1', type: 'task' }], drawn_for: 'p1',
    looks: [{ id: 's2', title: 'Theirs', props: { theme: { light: { ink: '#000000' } } }, about: ['p1'] }],
  });
  const { used } = await pageStyle(ctx, { of: 't1' });
  assert.ok(used.some((u) => u.id === 's2'), 'their own style is a layer');
});

test('screens: a preset for Home whose pack holds nothing yet waits', async () => {
  const ctx = context({ screens: [], held_types: [] });
  const { screens } = await withScreens(ctx, { screens: [{ id: 'core.home', pack: 'core', title: 'Home', at: 'home', pieces: [{ piece: 'note' }] }] });
  assert.equal(screens[0].idle, true);
});

test('the moves are planned as facts, and nothing to move plans none', async () => {
  assert.deepEqual(await planStyles(context({ style_moves: null })), { facts: [], views: 0, retired: 0 });
  const moved = await planStyles(context({
    style_moves: { styles: [{ id: 's1', props: { gap: 2 } }], ties: [{ style: 's1', to: 'v1', to_type: 'lens', gone: false }], about: [], kept: [{ id: 'v1', props: {} }] },
  }));
  assert.deepEqual(moved.facts, [['+', 'v1', 'style', { gap: 2 }], ['+', 's1', 'status', 'retired']]);
  const layouts = await planLayouts(context({ layout_moves: [{ id: 's2', props: { code: 'x', gap: 1 } }] }));
  assert.deepEqual(layouts, { facts: [['+', 's2', 'type', 'layout'], ['+', 's2', 'settings', { gap: 1 }], ['-', 's2', 'gap']], layouts: ['s2'] });
});

test("the moves are appended as the system's move, once each, and nothing to move appends nothing", async () => {
  const moves: unknown[][] = [];
  const at = (answers: Record<string, unknown>) => ({ ...context(answers), move: async (...m: unknown[]) => void moves.push(m) }) as KernelContext;
  assert.deepEqual(await moveStyles(at({ style_moves: null })), { views: 0, retired: 0 });
  assert.deepEqual(await moveLayouts(at({ layout_moves: [] })), []);
  assert.equal(moves.length, 0);
  assert.deepEqual(await moveLayouts(at({ layout_moves: [{ id: 's2', props: { code: 'x' } }] })), ['s2']);
  assert.deepEqual(moves.map(([action, reason]) => [action, reason]), [['layout.moved', LAYOUTS_MOVED]]);
});

test("a page's stylesheet is checked as the walls check it", () => {
  assert.equal(cssProblem('a { color: red }', true), undefined);
  assert.match(cssProblem('@import x;', true)!, /@import/);
  assert.equal(cssProblem('a:has(b) { color: red }', true), undefined, 'a page may look at what a part holds');
});
