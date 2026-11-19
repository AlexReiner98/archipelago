// An item is drawn from six slots a style sets (round 6, screen e_fgdwazkw): what each slot's words say, and that the
// three presets the canvas pack ships (Strata, Contour, Card) use only words the grammar reads.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// @ts-ignore a page module, untyped
import { glyphOf, grammar, itemMarks, itemRules } from './item-look.js';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'pack.json'), 'utf8'));
const preset = (id: string) => pack.styles.find((s: any) => s.id === id);
const m = (tag: string, attrs: any = {}, ...kids: any[]) => [tag, attrs, ...kids];
const sizes = new Proxy({}, { get: () => 3 }) as any;
const z = (n: string) => sizes[n];
const outline = (shape: string, x: number, y: number) => m('path', { d: `${shape}${x}${y}`, class: 'lf-shape' });
const step = { id: 's', w: 100, h: 34, shape: 'box' };
const marks = (style: any, phase: string, item: any = { type: 'task' }) => itemMarks({ g: grammar(style), n: step, at: [50, 17], phase, item, z, outline, m, corner: 6, dotAt: [10, 17] });

test('a style that says nothing keeps the dot and adds no rule', () => {
  const g = grammar({});
  assert.equal(g.dot, true);
  assert.equal(g.ink, 'line');
  assert.equal(g.fill, null);
  assert.deepEqual(marks({}, 'under_way'), { under: [], over: [] });
});

test('state is said once: no dot where the shape says it', () => {
  for (const word of ['double', 'foot', 'notch']) assert.equal(grammar({ item_state: word }).dot, false, word);
  assert.equal(grammar({ item_state: 'weight check' }).dot, true);
});

test('a foot, a second line and a notch are drawn by phase', () => {
  assert.equal(marks({ item_state: 'foot' }, 'under_way').over.length, 1);
  assert.equal(marks({ item_state: 'foot' }, 'not_started').over.length, 0);
  assert.equal(marks({ item_state: 'double' }, 'under_way').over[0][1].class, 'lf-shape lf-inner');
  assert.match(marks({ item_state: 'notch check' }, 'finished').over[0][1].class, /lf-tick/);
  assert.match(marks({ item_state: 'notch check' }, 'under_way').over[0][1].class, /lf-notch ph-under_way/);
  assert.match(marks({ item_state: 'foot check' }, 'finished').over[0][1].class, /lf-tick/);
});

test('a stratum has a slab under it until it is finished', () => {
  assert.match(marks({ item_fill: 'stratum' }, 'under_way').under[0][1].class, /lf-slab/);
  assert.equal(marks({ item_fill: 'stratum' }, 'finished').under.length, 0);
  assert.match(itemRules({ item_fill: 'stratum' }), /\.lf-slab/);
});

test('a glyph is read through what a type is a flavour of', () => {
  const g = grammar({ item_marks: { question: '?' } });
  assert.equal(glyphOf(g, { type: 'decision', is: ['question'] }), '?');
  assert.equal(glyphOf(g, { type: 'task' }), null);
  assert.equal(marks({ item_marks: { task: '#' } }, 'not_started').over.at(-1)[2], '#');
});

test('ink is the darker of sea and land in dark, the text in light, in one rule', () => {
  assert.match(itemRules({ item_ink: 'ink' }), /light-dark\(var\(--ln-text\), var\(--ln-sea\)\)/);
  assert.doesNotMatch(itemRules({ item_ink: 'line' }), /light-dark/);
});

test('the three presets are chosen ones that only use the grammar\'s words and no new colour', () => {
  for (const id of ['canvas.item_strata', 'canvas.item_contour', 'canvas.item_card']) {
    const p = preset(id);
    assert.equal(p.over, 'chosen', id);
    assert.ok(Object.values(p.props.type_shapes).every((s) => ['box', 'lozenge', 'pill', 'tab'].includes(s as string)), id);
    assert.doesNotMatch(JSON.stringify(p.props), /#[0-9a-f]{3,8}/i, id);
    assert.ok(itemRules({ ...p.props }).length > 0, id);
  }
  assert.equal(grammar(preset('canvas.item_contour').props).dot, false);
  assert.equal(grammar(preset('canvas.item_card').props).fill, 'lift');
});

test('the house style says every size the grammar reads', () => {
  const s = pack.styles.find((x: any) => x.id === 'core.house').props.sizes;
  for (const k of ['flow_slab', 'flow_double_gap', 'flow_foot', 'flow_notch_size', 'flow_glyph_text', 'flow_glyph_inset', 'flow_glyph_drop', 'flow_glyph_room', 'flow_item_lift', 'flow_stroke_ink']) assert.ok(k in s, k);
});

// ---- the land, round 6 (screen e_3sf9hbu9) ----
// @ts-ignore a page module, untyped
import { landGrammar, landMarks, landRules } from './land-look.js';

test('the land says nothing by default and reads its words when it does', () => {
  assert.deepEqual(landGrammar({}), { sea: 'flat', ground: 'tint', edge: 'rule', row: 0, snap: false });
  assert.equal(landGrammar({ sea: 'rows', row: 7, row_snap: true }).snap, true);
  assert.equal(landRules({}), '');
  assert.match(landRules({ sea: 'rows', row: 7 }), /lf-sea-rows/);
});

test('rows run over the sea and an island has its edge', () => {
  const islands = [{ id: 'e_aaaaaaaa', land: [{ l: 10, t: 10, r: 110, b: 60 }] }];
  const draw = (style: any) => landMarks({ style, g: {}, islands, size: { width: 200, height: 100 }, z, m, isHex: () => true });
  assert.equal(draw({ sea: 'rows', row: 10 }).sea.length, 1);
  assert.equal(draw({}).land.length, 0);
  assert.ok(draw({ land_edge: 'shallows' }).land[0].length > 3);
  assert.match(JSON.stringify(draw({ land_edge: 'skyline' }).land), /lf-skyline-edge/);
});

test('a terrace has as many steps as the phase, and a skyline its top inked', () => {
  const steps = (phase: string) => marks({ item_fill: 'terrace' }, phase).under.length;
  assert.deepEqual([steps('not_started'), steps('under_way'), steps('finished')], [1, 2, 3]);
  assert.match(JSON.stringify(marks({ item_ink: 'skyline' }, 'under_way').over), /lf-skyline/);
  assert.equal(grammar({ item_fill: 'terrace' }).dot, false);
});

test('the four ridge presets are chosen ones, and use no colour of their own', () => {
  for (const id of ['canvas.ridge_rows', 'canvas.ridge_terraces', 'canvas.ridge_hatched', 'canvas.ridge_skyline']) {
    const p = preset(id);
    assert.equal(p.over, 'chosen', id);
    assert.doesNotMatch(JSON.stringify(p.props), /#[0-9a-f]{3,8}/i, id);
    assert.ok(landRules(p.props).length > 0 && itemRules(p.props).length > 0, id);
  }
});
