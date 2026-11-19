// A palette is chosen alone among palettes and beside a chosen look: choosing one retires another palette, never the look.

import assert from 'node:assert/strict';
import test from 'node:test';

import { use } from './part-acts.ts';

const presets: any[] = [
  { id: 'canvas.waymark', title: 'Waymark', over: 'chosen', props: { who_strip: true } },
  { id: 'canvas.item_card', title: 'Card', over: 'chosen', props: {} },
  { id: 'canvas.theme_field', title: 'Theme: Field', over: 'palette', props: { theme: { light: { land_1: '#a9c98a' } } } },
  { id: 'canvas.theme_ochre', title: 'Theme: Ochre', over: 'palette', props: { theme: { light: { land_1: '#e3c48a' } } } },
];
const kept = (id: string, preset: string) => ({ id, title: preset, is_open: true, props: { preset } });

test('choosing a palette keeps the look and retires the other palette', () => {
  const made = use('canvas.theme_field', true, presets, [kept('e_look', 'canvas.waymark'), kept('e_ochre', 'canvas.theme_ochre')]);
  const retired = made.ops.filter((o) => o.status === 'retired').map((o) => o.id);
  assert.deepEqual(retired, ['e_ochre'], 'only the other palette goes');
  assert.ok(made.ops.some((o) => o.op === 'create' && (o.props as any).preset === 'canvas.theme_field'), 'the palette is kept');
  assert.match(made.reason, /palette/);
});

test('choosing a look keeps the palette and retires the other look', () => {
  const made = use('canvas.item_card', true, presets, [kept('e_look', 'canvas.waymark'), kept('e_field', 'canvas.theme_field')]);
  assert.deepEqual(made.ops.filter((o) => o.status === 'retired').map((o) => o.id), ['e_look']);
});
