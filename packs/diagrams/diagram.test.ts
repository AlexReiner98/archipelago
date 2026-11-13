// The diagrams pack's part, input in and marks out: an item's props.diagram drawn on a paint surface, areas first, then
// the wires, then the boxes. That the host takes its marks is test/diagram-part.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import diagram from './parts/diagram/index.js';

test('a diagram is a surface of its areas, wires and boxes, in that order', () => {
  const data = {
    width: 300,
    height: 100,
    boxes: [
      { id: 'b', kind: 'box', x: 0, y: 0, w: 100, h: 40, lines: ['one'] },
      { id: 'c', kind: 'box', x: 200, y: 0, w: 100, h: 40, lines: ['two'] },
      { id: 'a', kind: 'area', x: 0, y: 0, w: 300, h: 100, head: 20, lines: ['All'] },
    ],
    wires: [{ from: 'b', to: 'c' }],
  };
  const [, , head, plane] = diagram({ item: { id: 'e_aaaaaaaa', type: 'diagram', diagram: data } }).marks;
  assert.deepEqual(head.slice(2).map((m: unknown[]) => m[2]), ['2 boxes, 1 wires']);
  assert.deepEqual(plane.slice(2).map((m: [string, { d?: string }, string?]) => (m[0] === 'text' ? m[2] : m[1].d?.slice(0, 6))), ['M0 0h3', 'All', 'M100 2', 'M200 2', 'M6 0h8', 'one', 'M206 0', 'two']);
  assert.equal(diagram({ item: { id: 'e_aaaaaaaa', type: 'diagram' } }).marks[0], 'text', 'nothing made yet');
});
