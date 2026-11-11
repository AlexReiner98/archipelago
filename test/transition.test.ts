// What a scene mounted again plays (ui/transition.js), without a page: marks matched by key, staged as leave, move,
// arrive, and a cut where motion would not help.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { stagesOf } from '../ui/transition.js';

const house = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packs', 'canvas', 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house');
const numbers = house.props?.numbers ?? house.numbers;

type Row = { box: number[]; wire?: boolean; path?: string | null; holds?: boolean; within?: string | null; pulse?: string };
const marks = (rows: Record<string, Row>) => new Map(Object.entries(rows).map(([k, r]) => [k, { wire: false, path: null, holds: false, within: null, ...r }]));
const box = (x: number, y: number, w = 100, h = 30) => [x, y, w, h];

test('the house style names every number the page moves by', () => {
  for (const name of ['motion_leave', 'motion_move', 'motion_arrive', 'motion_movers_most', 'motion_marks_most', 'motion_still_within', 'motion_pulse']) assert.equal(typeof numbers[name], 'number', name);
});

test('what leaves, stays and arrives is matched by key, in three stages one after the other', () => {
  const before = marks({ flow: { box: box(0, 0, 800, 600), holds: true }, 's:a': { box: box(10, 10), within: 'flow' }, 's:b': { box: box(10, 60), within: 'flow' }, 's:gone': { box: box(10, 110), within: 'flow' }, 'w:0': { box: box(60, 40, 2, 20), wire: true, path: 'M60 40V60', within: 'flow' } });
  const after = marks({ flow: { box: box(0, 0, 800, 600), holds: true }, 's:a': { box: box(10, 10), within: 'flow' }, 's:b': { box: box(210, 60), within: 'flow' }, 's:new': { box: box(10, 160), within: 'flow' }, 'w:0': { box: box(60, 40, 152, 20), wire: true, path: 'M60 40H210V60', within: 'flow' }, 'w:1': { box: box(60, 90, 2, 70), wire: true, path: 'M60 90V160', within: 'flow' } });
  const plan = stagesOf(before, after, numbers);
  assert.equal(plan.cut, null);
  assert.deepEqual(plan.leave, ['s:gone']);
  // A mark that stays moves from where it was, by how far it went on the screen; one that did not move is left be.
  assert.deepEqual(plan.move, [{ key: 's:b', dx: -200, dy: 0 }]);
  assert.deepEqual(plan.arrive, ['s:new']);
  // A wire that changed shape cannot be moved: it is drawn in again, with a new one.
  assert.deepEqual(plan.draw, ['w:0', 'w:1']);
  const { leave, move, arrive } = plan.times;
  assert.deepEqual(leave, [0, numbers.motion_leave]);
  assert.deepEqual(move, [numbers.motion_leave, numbers.motion_move]);
  assert.deepEqual(arrive, [numbers.motion_leave + numbers.motion_move, numbers.motion_arrive]);
});

test('a stage with nothing in it takes no time', () => {
  const before = marks({ 's:a': { box: box(0, 0) } });
  const after = marks({ 's:a': { box: box(0, 0) }, 's:b': { box: box(0, 50) } });
  const plan = stagesOf(before, after, numbers);
  assert.deepEqual(plan.arrive, ['s:b']);
  assert.deepEqual(plan.times.arrive, [0, numbers.motion_arrive]);
});

test('what is inside a mark that arrives or leaves goes with it; what holds marks is not moved', () => {
  const before = marks({ 'g:old': { box: box(0, 0), holds: true }, 'd:old': { box: box(2, 2, 8, 8), within: 'g:old' }, 'held:p:x': { box: box(0, 40), holds: true }, 's:x': { box: box(0, 40), within: 'held:p:x' } });
  const after = marks({ 'g:new': { box: box(0, 0), holds: true }, 'd:new': { box: box(2, 2, 8, 8), within: 'g:new' }, 'held:p:x': { box: box(0, 90), holds: true }, 's:x': { box: box(0, 90), within: 'held:p:x' } });
  const plan = stagesOf(before, after, numbers);
  assert.deepEqual(plan.leave, ['g:old']);
  assert.deepEqual(plan.arrive, ['g:new']);
  assert.deepEqual(plan.move, [{ key: 's:x', dx: 0, dy: -50 }]);
});

test('a mark that changed size is put in its place as it is', () => {
  const plan = stagesOf(marks({ 'i:a': { box: box(0, 0, 300, 200) }, 's:a': { box: box(0, 0) } }), marks({ 'i:a': { box: box(40, 0, 340, 200) }, 's:a': { box: box(0, 0) } }), numbers);
  assert.equal(plan.cut, 'still');
});

test('it cuts: on less motion, past a few movers, on too many marks, and when nothing is shared', () => {
  const before = marks({ 's:a': { box: box(0, 0) } }), after = marks({ 's:a': { box: box(50, 0) } });
  assert.equal(stagesOf(before, after, numbers).cut, null);
  assert.equal(stagesOf(before, after, numbers, true).cut, 'reduced');
  const many = numbers.motion_movers_most + 1;
  // Each goes its own way: no frame moved them together.
  const rows = (dx: number) => marks(Object.fromEntries(Array.from({ length: many }, (_, i) => [`s:${i}`, { box: box(dx * (i + 1), i * 40) }])));
  assert.equal(stagesOf(rows(0), rows(80), numbers).cut, 'many');
  assert.equal(stagesOf(rows(0), rows(80), { ...numbers, motion_movers_most: many }).cut, null);
  assert.equal(stagesOf(before, after, { ...numbers, motion_marks_most: 1 }).cut, 'marks');
  assert.equal(stagesOf(before, marks({ 's:b': { box: box(0, 0) } }), numbers).cut, 'new');
  assert.equal(stagesOf(new Map(), after, numbers).cut, 'new');
  // Moved by less than the style's still_within is not moved.
  assert.equal(stagesOf(before, marks({ 's:a': { box: box(numbers.motion_still_within / 2, 0) } }), numbers).cut, 'still');
});

test('a style that names no number for it says so', () => {
  assert.throws(() => stagesOf(marks({ 's:a': { box: box(0, 0) } }), marks({ 's:a': { box: box(9, 0) } }), {}), /names no number "motion_marks_most"/);
});

test('what most marks went by together is the frame moving: it moves back as one, and a mark by what it went alone', () => {
  const before = marks({ 's:a': { box: box(0, 0) }, 's:b': { box: box(0, 50) }, 's:c': { box: box(0, 100) }, 'w:0': { box: box(50, 30, 2, 20), wire: true, path: 'M50 30V50' } });
  const after = marks({ 's:a': { box: box(-30, 20) }, 's:b': { box: box(-30, 70) }, 's:c': { box: box(170, 120) }, 'w:0': { box: box(20, 50, 2, 20), wire: true, path: 'M50 30V50' } });
  const plan = stagesOf(before, after, numbers);
  assert.deepEqual(plan.frame, { dx: 30, dy: -20 });
  assert.deepEqual(plan.move, [{ key: 's:c', dx: -200, dy: 0 }]);
  // A wire the frame took with it, its shape the same, is not drawn again.
  assert.deepEqual(plan.draw, []);
  assert.deepEqual(plan.times.move, [0, numbers.motion_move]);
  // A picture whose frame cannot be moved (laid out by the page) moves each mark.
  assert.equal(stagesOf(before, after, numbers, false, false).move.length, 3);
});

test('a pulse runs when its words change, after what moves, and even where the rest is cut', () => {
  const still = { 's:a': { box: box(0, 0) } };
  const was = marks({ ...still, 'pulse:f:r': { box: box(0, 50, 200, 2), wire: true, path: 'M0 50H200', pulse: '[400]' } as Row });
  const now = (said: string, rows: Record<string, Row> = still) => marks({ ...rows, 'pulse:f:r': { box: box(0, 50, 200, 2), wire: true, path: 'M0 50H200', pulse: said } as Row });
  // Nothing else changed: the rest is still, and the pulse runs at once.
  const alone = stagesOf(was, now('[450]'), numbers);
  assert.equal(alone.cut, 'still');
  assert.deepEqual(alone.pulse, ['pulse:f:r']);
  assert.deepEqual(alone.times.pulse, [0, numbers.motion_pulse]);
  // Its words the same: nothing runs, and a pulse is never faded, moved or drawn in.
  const same = stagesOf(was, now('[400]', { 's:a': { box: box(0, 0) }, 's:b': { box: box(0, 90) } }), numbers);
  assert.deepEqual([same.pulse, same.arrive, same.draw], [[], ['s:b'], []]);
  assert.deepEqual(stagesOf(marks(still), now('[450]'), numbers).arrive, [], 'a pulse that comes is not seen');
  // With what moves: it runs after the move.
  const moved = stagesOf(was, now('[450]', { 's:a': { box: box(0, 0) }, 's:b': { box: box(0, 90) } }), numbers);
  assert.deepEqual(moved.pulse, ['pulse:f:r']);
  assert.deepEqual(moved.times.pulse, [moved.times.arrive[0], numbers.motion_pulse]);
  // Less motion asked for: nothing runs.
  assert.deepEqual(stagesOf(was, now('[450]'), numbers, true).pulse, []);
});
