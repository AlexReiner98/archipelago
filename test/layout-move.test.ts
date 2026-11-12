// A layout is its own type (decision e_nv3rfcge): which styles become layouts, and the facts that make them so,
// read with no database.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutsMoved } from '../packs/styles/kernel/layout-move.ts';

const drawings = new Set(['core.grid']);

test('a style with code becomes a layout, its other fields its settings', () => {
  const facts = layoutsMoved([{ id: 's', props: { code: 'x', writes: ['a.b'], text: 13, colors: { sea: '#000' } } }], drawings);
  assert.deepEqual(facts, [
    ['+', 's', 'type', 'layout'],
    ['+', 's', 'settings', { text: 13, colors: { sea: '#000' } }],
    ['-', 's', 'text'],
    ['-', 's', 'colors'],
  ]);
});

test('a style with code and nothing else becomes a layout with no settings', () => {
  assert.deepEqual(layoutsMoved([{ id: 's', props: { code: 'x' } }], drawings), [['+', 's', 'type', 'layout']]);
});

test("the owner's version of a pack drawing becomes a layout, keeping its preset and modules", () => {
  const facts = layoutsMoved([{ id: 'v', props: { preset: 'core.grid', modules: { 'index.js': 'y' } } }, { id: 'p', props: { preset: 'core.house' } }], drawings);
  assert.deepEqual(facts, [['+', 'v', 'type', 'layout']]);
});

test('a style with no code stays a style', () => {
  assert.deepEqual(layoutsMoved([{ id: 's', props: { shape: 'flow', theme: {} } }], drawings), []);
});
