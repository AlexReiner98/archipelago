// The canvas drawing, run without a database or a page: a lens answer in, geometry and marks out. Checked for what a
// reader relies on: what is inside a thing is drawn inside its land, nothing overlaps what is beside it, what is
// depended on sits above what depends on it, a wire points at the one that waits, every outline draws, and the
// drawing answers hovering with a tip and lit wires. A drawing pack's tests are its template's too.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error: plain modules of the drawing, with no types of their own.
import { layout } from './draw/layout.js';
// @ts-expect-error: as above.
import { OUTLINES, outline, outlineOf, roomOf } from './draw/outlines.js';
// @ts-expect-error: as above.
import { picture } from './draw/index.js';

const state = { blocked: false, waits_on: [], sessions: 0, needs_you: false };
const within = { items: 0, work: 0, blocked: 0, needs_you: 0 };
const item = (id: string, inside: string | null, extra: Record<string, unknown> = {}) => ({ id, type: 'work.task', root: 'work.task', kind: 'work', title: `Item ${id}`, status: 'todo', open: true, inside, place: 0, state, within, ...extra });
const measure = (text: string, px: number) => text.length * px * 0.55;
// Laid out by the canvas pack's own preset, as the page lays it out.
const preset = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'canvas.house').props;
const run = (items: any[], links: any[] = []) => layout({ items, links, measure, sizes: preset.sizes, numbers: preset.numbers, outlines: preset.outlines });
const inside = (a: any, b: any) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const apart = (a: any, b: any) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

test('what a thing holds is drawn inside its land, below its head, and nothing beside it overlaps', () => {
  const items = [item('p', null, { type: 'work.project', root: 'work.project' }), item('f', 'p'), item('a', 'f'), item('b', 'f'), item('c', 'p'), item('d', null)];
  const g = run(items);
  const [p, f, a, b, c, d] = ['p', 'f', 'a', 'b', 'c', 'd'].map((id) => g.nodes.get(id));
  assert.ok(p.region && f.region && !a.region, 'what holds others is a region');
  for (const [kid, up] of [[f, p], [c, p], [a, f], [b, f]]) assert.ok(inside(kid, up) && kid.y >= up.y + up.head, `${kid.id} is inside ${up.id}, under its head`);
  for (const [x, y] of [[f, c], [a, b], [p, d]]) assert.ok(apart(x, y), `${x.id} and ${y.id} do not overlap`);
  assert.equal(p.outline, 'folder', "a project's land is a folder, as the preset names it");
  assert.ok(g.width >= p.x + p.w && g.height >= p.y + p.h, 'the picture holds all of it');
});

test('what is depended on sits above what depends on it, and the wire points at the one that waits', () => {
  const g = run([item('r', null), item('a', 'r'), item('b', 'r'), item('c', 'r')], [{ kind: 'depends_on', from: 'b', to: 'a', n: 1 }, { kind: 'depends_on', from: 'c', to: 'b', n: 1 }]);
  const [a, b, c] = ['a', 'b', 'c'].map((id) => g.nodes.get(id));
  assert.ok(a.y + a.h <= b.y && b.y + b.h <= c.y, 'a over b over c');
  const w = g.wires.find((x: any) => x.from === 'a' && x.to === 'b');
  assert.ok(w?.arrow, 'from what is depended on to what depends on it, with a head');
  assert.deepEqual(w.end, [b.x + b.w / 2, b.y], 'it ends on the top of the one that waits');
});

test('a link between a thing and what holds it is no wire; a mention is a thread with no head', () => {
  const g = run([item('r', null), item('a', 'r'), item('b', 'r')], [{ kind: 'depends_on', from: 'a', to: 'r', n: 1 }, { kind: 'mentions', from: 'a', to: 'b', n: 1 }]);
  assert.equal(g.wires.length, 1);
  assert.equal(g.wires[0].kind, 'mentions');
  assert.equal(g.wires[0].arrow, false);
});

test('an outline is chosen by type, then root, then kind, and every outline draws in any box', () => {
  const map = { 'work.issue': 'octagon', question: 'diamond' };
  assert.equal(outlineOf({ type: 'work.issue', root: 'work.issue', kind: 'work' }, map), 'octagon');
  assert.equal(outlineOf({ type: 'work.decision', root: 'work.decision', kind: 'question' }, map), 'diamond');
  assert.equal(outlineOf({ type: 'x.y', root: 'x.y', kind: 'place' }, { place: 'no such outline' }), 'box');
  for (const name of Object.keys(OUTLINES)) {
    const marks = outline(name, 10, 20, 160, 40, 6, 'sp-shape');
    assert.ok(Array.isArray(marks) && marks.length >= 1, `${name} draws`);
    for (const [tag, attrs] of marks) assert.ok(['rect', 'path', 'polygon', 'circle', 'ellipse'].includes(tag) && !JSON.stringify(attrs).includes('NaN'), `${name} draws a plain shape`);
    const room = roomOf(name, 34);
    assert.ok(room.h >= 34 && room.left >= 0 && room.right >= 0, `${name} says the room it needs`);
  }
});

test('the drawing answers with a scene, a tip and lit wires on hovering, and marks what is open on a restyle', () => {
  const answer = { viewer: 'me', items: [item('r', null), item('a', 'r', { note: 'The point of a, in a line.' }), item('b', 'r')], links: [{ kind: 'depends_on', from: 'b', to: 'a', n: 1 }] };
  const drawn = picture({ answer, style: { ...preset, here: 'a' }, types: { 'work.task': 'Task' } }, { measure });
  const svg = JSON.stringify(drawn.scene.svg);
  assert.ok(svg.includes('#/e/a') && svg.includes('Item a'), 'each thing is a link to its page, named');
  assert.ok(drawn.scene.start, 'it opens on what is open');
  const hovered = drawn.on({ name: 'enter', key: 'n:a' });
  const tip = hovered.find((p: any) => p.tip);
  assert.ok(JSON.stringify(tip.tip.mark).includes('The point of a, in a line.'), "the tip says the first line of the item's note");
  assert.ok(hovered.some((p: any) => p.key?.startsWith('w:') && p.toggle.lit), 'its wire lights');
  assert.ok(drawn.on({ name: 'leave', key: 'n:a' }).some((p: any) => p.tip === null), 'leaving takes the tip away');
  assert.ok(drawn.restyle({ ...preset, here: 'b' }).some((p: any) => p.key === 'n:b' && p.toggle.here), 'a restyle moves what is marked');
  assert.ok(picture({ answer: { items: [], links: [] }, style: preset }, { measure }).scene.message, 'with nothing to draw it says so');
});
