// The diagrams pack's part (packs/diagrams/parts/diagram): an item's props.diagram in, a paint surface of its areas,
// wires and boxes out, which the host's check takes (packs/walls/page/part-check.js).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks as checkAny } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import diagram, { edge } from '../packs/diagrams/parts/diagram/index.js';

const kinds = JSON.parse(readFileSync(new URL('../packs/diagrams/pack.json', import.meta.url), 'utf8')).parts[0].marks;
const checkMarks = (marks: unknown) => checkAny(marks, { kinds });

const data = {
  id: 'd1',
  name: 'Modules',
  width: 400,
  height: 300,
  drawio: 'https://github.com/o/r/blob/abc/docs/modules.drawio',
  boxes: [
    { id: 'a', kind: 'area', x: 0, y: 0, w: 400, h: 300, head: 20, lines: ['Kernel', 'ignored'] },
    { id: 'b', kind: 'box', x: 20, y: 40, w: 100, h: 40, lines: ['write', 'pelago.ts'], bold: true, tooltip: 'The write path', link: 'https://github.com/o/r/blob/abc/packs/write/kernel/pelago.ts' },
    { id: 'c', kind: 'box', x: 220, y: 40, w: 100, h: 40, lines: ['log'], tone: 'warn', dashed: true },
    { id: 'd', kind: 'box', x: 220, y: 200, w: 100, h: 40, lines: ['seal'], tone: 'strong' },
    { id: 't', kind: 'text', x: 20, y: 200, w: 100, h: 20, lines: ['a note'] },
  ],
  wires: [
    { from: 'b', to: 'c', label: 'appends' },
    { from: 'c', to: 'd', dashed: true, faint: true },
    { from: 'b', to: 'gone' },
  ],
};

test('a diagram is answered as a surface of its areas, wires and boxes, which the host checks', () => {
  const part = diagram({ item: { id: 'e_aaaaaaaa', type: 'diagram', diagram: data } });
  const drawn = checkMarks(part.marks);
  const [head, plane] = drawn.kids;
  assert.equal(head.kids[0].words, '4 boxes, 3 wires');
  assert.equal(head.kids[1].at.href, data.drawio);
  assert.equal(plane.mark, 'paint');
  assert.deepEqual([plane.at.width, plane.at.height], [400, 300]);
  const words = plane.kids.filter((k: { mark: string }) => k.mark === 'text').map((k: { words: string }) => k.words);
  assert.deepEqual(words, ['Kernel', 'appends', 'write', 'pelago.ts', 'log', 'seal', 'a note'], 'an area shows its heading alone; areas, then wires, then boxes');
  const paths = plane.kids.filter((k: { mark: string }) => k.mark === 'path');
  // The area, two wires each a line and an arrowhead (the one to a box not drawn left out), three boxes.
  assert.equal(paths.length, 1 + 2 * 2 + 3);
  assert.equal(paths[0].at.d, 'M0 0h400v300h-400Z');
  assert.equal(paths.at(-2).at.look, 'dash', 'a dashed box');
  assert.equal(paths.at(-2).at.tone, 'warn');
  assert.equal(paths.at(-1).at.look, 'strong', 'a strong box is filled');
  assert.equal(paths[0].at.look, 'area', 'an area is filled from the style');
  assert.equal(paths.at(-3).at.look, 'box', 'a box is filled over the wires');
  assert.equal(plane.at.controls, true, 'with its zoom buttons');
  assert.equal(paths[1].at.tip, 'write → log: appends', 'a wire says what it joins');
  assert.equal(paths[3].at.look, 'dash', 'a dashed wire');
  assert.deepEqual([paths.at(-3).at.tip, paths.at(-3).at.href], ['The write path', 'https://github.com/o/r/blob/abc/packs/write/kernel/pelago.ts'], 'a box keeps its tip and its link');
  assert.equal(paths[3].at.tone, 'closed', 'a faint wire');
});

test('a wire leaves a box at its edge, and nothing drawn yet says so', () => {
  assert.deepEqual(edge({ x: 0, y: 0, w: 100, h: 40 }, [250, 20]), [100, 20]);
  assert.deepEqual(edge({ x: 0, y: 0, w: 100, h: 40 }, [50, 20]), [50, 20]);
  for (const d of [undefined, {}, { ...data, boxes: [] }]) {
    const part = diagram({ item: { id: 'e_aaaaaaaa', type: 'diagram', ...(d && { diagram: d }) } });
    assert.match(checkMarks(part.marks).words, /Nothing drawn yet/);
  }
  const part = diagram({ item: null });
  assert.equal(checkMarks(part.update({ item: { id: 'e_aaaaaaaa', type: 'diagram', diagram: { ...data, drawio: 'javascript:alert(1)' } } })).kids[0].kids.length, 1, 'no file that is not on the web');
});
