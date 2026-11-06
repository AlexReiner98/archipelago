// A moved finding travels to its readers (task e_fqhbp4yq): the flow's island marks draw, for each finding read
// across, a pulse from the finding's gate through the sea to the reader's, carrying what the finding promises, so the
// page runs it when that moves (ui/transition.js). Pure: a composed model in, marks out.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-ignore: a pack's drawing code, plain JavaScript
import { islandMarks } from '../packs/core/layouts/flow/islands.js';

const house = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packs', 'core', 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house');
const sizes = (house.props ?? house).sizes;
const m = (tag: string, attrs: Record<string, unknown>, ...kids: unknown[]) => [tag, attrs, ...kids.flat()];
type Mark = [string, Record<string, unknown>, ...unknown[]];
const all = (marks: unknown[]): Mark[] => marks.flatMap((k) => (Array.isArray(k) && typeof k[0] === 'string' ? [k as Mark, ...all(k.slice(2))] : Array.isArray(k) ? all(k) : []));

function drawn(value: unknown) {
  const finding = { id: 'e_finding1', title: 'Runway', island: 'e_islanda1', fields: { value, as_of: '2026-11-05' } };
  const reader = { id: 'e_reader01', title: 'Launch in January?', island: 'e_islandb1' };
  const land = [{ l: 0, t: 0, r: 100, b: 60 }];
  const g = {
    nodes: new Map([[finding.id, { item: finding }], [reader.id, { item: reader }]]),
    islands: [{ id: 'e_islanda1', land, name: [0, 0], entries: [] }, { id: 'e_islandb1', land: [{ l: 0, t: 200, r: 100, b: 260 }], name: [0, 200], entries: [] }],
    ties: [{ a: reader.id, b: finding.id, crossing: true, points: [[50, 200], [50, 130], [50, 60]], gates: [{ island: 'e_islandb1', at: [50, 196], way: [0, -1], k: 1 }, { island: 'e_islanda1', at: [50, 64], way: [0, 1], k: 1 }], sea: [[50, 196], [50, 130], [50, 64]], label: { id: 'e_name0001', at: [50, 64], w: 132 } }],
  };
  return islandMarks({ g, legends: new Map(), islands: [{ id: 'e_islanda1', title: 'Money' }, { id: 'e_islandb1', title: 'Beta' }], style: { hues: ['#2b7a78', '#c06c84'] }, z: (name: string) => sizes[`flow_${name}`], m, titled: (mark: unknown) => mark, outline: (shape: string, x: number, y: number, w: number, h: number) => m('path', { d: `${shape} ${x} ${y} ${w} ${h}` }), fit: (t: string) => t, isHex: (h: string) => /^#[0-9a-f]{3,8}$/i.test(h) });
}

test('a finding read across has a pulse from its gate to its reader’s, keyed by the two, carrying what it promises', () => {
  const pulses = all(drawn(6).gates).filter(([, a]) => String(a.key).startsWith('pulse:'));
  assert.equal(pulses.length, 1);
  const [tag, attrs] = pulses[0];
  assert.equal(tag, 'path');
  assert.equal(attrs.key, 'pulse:e_finding1:e_reader01', 'the same mark however the picture is laid out');
  // From the finding's shore to the reader's: it runs the way the finding travels.
  assert.equal(attrs.d, 'M50 64L50 130L50 196');
  assert.equal(attrs.pulse, JSON.stringify([6, '2026-11-05']));
  assert.match(String(attrs.class), /lf-pulse lf-island lf-i-2b7a78/, 'in the colour of the finding’s island');
  assert.notEqual(all(drawn(5).gates).find(([, a]) => a.key === attrs.key)?.[1].pulse, attrs.pulse, 'a moved value changes what it carries');
});

test('the pulse’s look is the style’s', () => {
  for (const name of ['flow_island_pulse_stroke', 'flow_island_pulse_dash']) assert.equal(typeof sizes[name], 'number', name);
});
