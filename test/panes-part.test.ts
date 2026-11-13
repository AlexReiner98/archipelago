// The panes pack's one part (packs/panes/parts/index.js), mounted in the strip of tabs and in the panes as the runtime
// mounts it: every answer is marks the host draws (packs/walls/page/part-check.js), and both mounts read one model.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
// @ts-expect-error: a module of the page, plain JavaScript.
import { checkMarks } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import part, { reset } from '../packs/panes/parts/index.js';

const kinds = JSON.parse(readFileSync('packs/panes/pack.json', 'utf8')).parts[0].marks as string[];
type Said = { marks: unknown; on: (e: unknown) => unknown; update: (i: unknown) => unknown };

function mountBoth() {
  reset();
  const kept: Record<string, unknown> = {};
  const drawn: Record<string, unknown> = {};
  const tools = (slot: string) => ({ marks: (m: unknown) => (checkMarks(m, { kinds }), (drawn[slot] = m)), keep: (v: unknown, n: string) => (kept[n] = v), state: () => {} });
  const strip = part({ slot: 'tabs', address: { hash: '#/v?f=a' } }, tools('tabs')) as Said;
  const panes = part({ piece: { slot: 'panes' } }, tools('panes')) as Said;
  checkMarks(strip.marks, { kinds });
  checkMarks(panes.marks, { kinds });
  return { strip, panes, kept, drawn };
}
const keys = (m: unknown): string[] => (Array.isArray(m) ? [...(m[1]?.key ? [m[1].key] : []), ...m.slice(1).flatMap(keys)] : []);

test('a new tab from the strip is drawn in the strip and its pane in the panes, and kept', () => {
  const { strip, kept, drawn } = mountBoth();
  const after = strip.on({ key: 'new', name: 'press' });
  checkMarks(after, { kinds });
  assert.equal(keys(after).filter((k) => k.startsWith('tab:')).length, 2);
  assert.equal((kept.tabs as { list: unknown[] }).list.length, 2);
  assert.ok(keys(drawn.panes).some((k) => k.startsWith('pane:')), 'the panes mount is drawn again');
});

test('a pane dragged onto the strip goes to a tab of its own; the line between two shares the room', () => {
  const { strip, panes } = mountBoth();
  const tab = keys(strip.marks).find((k) => k.startsWith('tab:'))!;
  assert.equal(strip.on({ key: `front:${tab.slice(4)}`, name: 'press' }), undefined, 'the tab in sight: nothing to do');
  const first = keys(panes.marks).find((k) => k.startsWith('pane:'))!;
  assert.equal(panes.on({ key: first, name: 'drop', value: { onto: null, zone: 'tabs' } }), undefined, 'the last pane stays');
  panes.on({ key: first, name: 'open', value: { at: 'v?f=b' } });
  const two = panes.on({ key: 'panes', name: 'share', value: { index: 0, at: 0.5 } });
  assert.equal(two, undefined, 'one pane has no line');
  assert.equal(panes.on({ key: first, name: 'named', value: 'Tasks' }) !== undefined, true);
  assert.match(JSON.stringify(strip.on({ key: 'new', name: 'press' })), /Tasks/, 'a tab is named by what its pane draws');
});
