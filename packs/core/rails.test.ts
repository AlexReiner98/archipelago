// The rails (core.rails, decision e_btxq2nzq): a view's items laid out as a map, walked stop by stop in the view's
// order. Answer in, marks and stops out: no database. The modules are set out under the names pack.json gives them,
// as the page loads them.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = pack.styles.find((s: any) => s.id === 'core.house').props;
const laid = mkdtempSync(join(tmpdir(), 'pelago-rails-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.rails').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { layout } = await import(pathToFileURL(join(laid, 'layout.js')).href);
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
const measure = (t: string, px: number) => t.length * px * 0.55;

const item = (id: string, title = `Stop ${id}`, body?: string) => ({ id, type: 'task', title, ...(body && { body }), fields: {} });
const link = (type: string, from: string, to: string) => ({ id: `r_${type}_${from}_${to}`, type, from, to });
const laidOut = (items: any[], links: any[], numbers = {}, sizes = {}) => layout({ items, links, measure, sizes: { ...house.sizes, ...sizes }, numbers: { ...house.numbers, ...numbers } });
const square = (points: number[][]) => points.slice(1).every((q, k) => q[0] === points[k][0] || q[1] === points[k][1]);
const onEdge = ([x, y]: number[], b: any) => (Math.abs(Math.abs(x - b.x) - b.w / 2) < 0.01 && Math.abs(y - b.y) <= b.h / 2) || (Math.abs(Math.abs(y - b.y) - b.h / 2) < 0.01 && Math.abs(x - b.x) <= b.w / 2);

test('the walk reads what an item rests on before it, else as the answer gives them', () => {
  const g = laidOut([item('a'), item('b'), item('c'), item('d')], [link('depends_on', 'a', 'c'), link('relates_to', 'b', 'd')]);
  assert.deepEqual(g.order.map((i: any) => i.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(g.stops.map((s: any) => s.id), ['c', 'a', 'b', 'd']);
});

test('an order field the view sets comes first', () => {
  const items = [item('a'), item('b'), item('c')].map((i, k) => ({ ...i, fields: { order: 3 - k } }));
  assert.deepEqual(laidOut(items, []).order.map((i: any) => i.id), ['c', 'b', 'a']);
});

test('the rows run back and forth, so the rail is straight from stop to stop', () => {
  const ids = Array.from({ length: 7 }, (_, k) => `n${k}`);
  const g = laidOut(ids.map((id) => item(id)), [], { rails_columns: 3 });
  const at = (id: string) => g.boxes.get(id);
  // Row one left to right, row two right to left, under the end of row one.
  assert.ok(at('n0').x < at('n1').x && at('n1').x < at('n2').x);
  assert.equal(at('n3').x, at('n2').x);
  assert.ok(at('n4').x < at('n3').x && at('n5').x < at('n4').x);
  assert.equal(at('n6').x, at('n5').x);
  assert.equal(g.rails.length, 6);
  for (const r of g.rails) {
    assert.equal(r.points.length, 2, 'one straight stretch');
    assert.ok(square(r.points));
    assert.ok(onEdge(r.points[0], at(r.a)) && onEdge(r.points[1], at(r.b)), 'from edge to edge');
  }
});

test('a link between stops that follow one another rides the rail, its head where it points', () => {
  const g = laidOut([item('a'), item('b'), item('c')], [link('depends_on', 'b', 'a'), link('relates_to', 'b', 'c')], { rails_columns: 3 });
  assert.equal(g.wires.length, 0);
  const ab = g.rails[0];
  assert.equal(ab.link.type, 'depends_on');
  assert.ok(onEdge(ab.points.at(-1), g.boxes.get('a')), 'drawn from b to a, where it points');
});

test('every other link is a wire at right angles, from its from to its to, round the stops', () => {
  const ids = Array.from({ length: 9 }, (_, k) => `n${k}`);
  const links = [link('relates_to', 'n0', 'n2'), link('relates_to', 'n7', 'n1'), link('part_of', 'n0', 'n8'), link('relates_to', 'n4', 'n6')];
  const g = laidOut(ids.map((id) => item(id)), links, { rails_columns: 3 });
  assert.equal(g.wires.length, links.length);
  for (const w of g.wires) {
    assert.ok(square(w.points), `${w.id} at right angles`);
    assert.ok(onEdge(w.points[0], g.boxes.get(w.a)) && onEdge(w.points.at(-1), g.boxes.get(w.b)), `${w.id} from edge to edge`);
    for (const b of g.boxes.values()) {
      if (b.id === w.a || b.id === w.b) continue;
      for (let k = 1; k < w.points.length; k++) {
        const [p, q] = [w.points[k - 1], w.points[k]];
        const inside = Math.max(p[0], q[0]) > b.x - b.w / 2 && Math.min(p[0], q[0]) < b.x + b.w / 2 && Math.max(p[1], q[1]) > b.y - b.h / 2 && Math.min(p[1], q[1]) < b.y + b.h / 2;
        assert.ok(!inside, `${w.id} clear of ${b.id}`);
      }
    }
  }
});

test('the stops are the camera on each item, and the whole the camera on all of it', () => {
  const g = laidOut([item('a', 'One memory', '## Why\nskip\n\nWhat it is, in a line.\n\nMore.'), item('b')], []);
  const [a] = g.stops;
  assert.deepEqual([a.x, a.y], [g.boxes.get('a').x, g.boxes.get('a').y]);
  assert.equal(a.title, 'One memory');
  assert.equal(a.note, 'What it is, in a line.');
  assert.equal(a.span, Math.max(house.sizes.rails_stop_span, g.boxes.get('a').w + 2 * house.sizes.rails_column_gap));
  assert.equal(a.zoom, g.size.width / a.span);
  assert.deepEqual(g.whole, { x: g.size.width / 2, y: g.size.height / 2, span: g.size.width, zoom: 1 });
});

test('every length is a size on the style', () => {
  const items = [item('a'), item('b'), item('c'), item('d')], links = [link('relates_to', 'a', 'd')];
  const one = laidOut(items, links, { rails_columns: 2 }), two = laidOut(items, links, { rails_columns: 2 }, { rails_margin: house.sizes.rails_margin * 2, rails_row_gap: house.sizes.rails_row_gap * 2 });
  assert.equal(two.size.width - one.size.width, 2 * house.sizes.rails_margin);
  assert.ok(two.size.height > one.size.height + 2 * house.sizes.rails_margin);
  const long = laidOut([item('a', 'A name long enough that it must be folded onto more than one line in its box')], [], { rails_lines_most: 2 });
  assert.equal(long.boxes.get('a').lines.length, 2);
  assert.ok(long.boxes.get('a').lines[1].endsWith('…'));
});

test('the picture is marks the page checks, with its stops beside them', () => {
  const answer = { items: [item('a'), item('b'), item('c')], links: [link('depends_on', 'b', 'a'), link('relates_to', 'a', 'c')] };
  const { scene } = picture({ answer, style: house, relations: { relates_to: 'Relates to' } }, { measure });
  assert.equal(scene.svg[0], 'svg');
  assert.deepEqual(scene.stops.map((s: any) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(scene.start, [scene.stops[0].x, scene.stops[0].y]);
  const text = JSON.stringify(scene.svg);
  for (const id of ['a', 'b', 'c']) assert.ok(text.includes(`"href":"#/e/${id}"`) && text.includes(`"item":"${id}"`));
  assert.ok(scene.key.some((k: any) => k.label === 'Relates to') && scene.key.some((k: any) => k.label === 'The walk'));
  assert.ok(/--ln-rails-/.test(scene.css));
  assert.deepEqual(picture({ answer: { items: [], links: [] }, style: house }, { measure }).scene, { message: 'Nothing here yet.' });
});
