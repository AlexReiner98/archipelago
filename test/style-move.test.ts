// Styles made for one view move into it (decision e_47pjkbxb): what becomes of each style, read with no database.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stylesMoved } from '../src/style-move.ts';

const isView = (type: string) => type === 'lens';
const tie = (style: string, to: string, to_type: string, gone = false) => ({ style, to, to_type, gone });

test('a style about a view moves into it and is retired', () => {
  const { held, retired } = stylesMoved([{ id: 's', props: { shape: 'grid', labels: { null: 'Kind' } } }], [tie('s', 'v', 'lens')], new Map(), isView, new Map());
  assert.deepEqual(held.get('v'), { shape: 'grid', labels: { null: 'Kind' } });
  assert.deepEqual(retired, ['s']);
});

test('a style about an item moves into every view of it, and one about the view lies over it', () => {
  const styles = [{ id: 'near', props: { shape: 'flow' } }, { id: 'far', props: { shape: 'grid', gap: 3 } }];
  const { held } = stylesMoved(styles, [tie('near', 'v', 'lens'), tie('far', 'item', 'project')], new Map([['item', ['v', 'w']]]), isView, new Map());
  assert.deepEqual(held.get('v'), { shape: 'flow', gap: 3 });
  assert.deepEqual(held.get('w'), { shape: 'grid', gap: 3 });
});

test('a layout stays, and a view of what it was about names it', () => {
  const { held, retired } = stylesMoved([{ id: 'k', props: { code: 'x' } }], [tie('k', 'item', 'project')], new Map([['item', ['v']]]), isView, new Map());
  assert.deepEqual(held.get('v'), { style: 'k' });
  assert.deepEqual(retired, []);
});

test('a view that names another layout keeps it', () => {
  const { held } = stylesMoved([{ id: 'k', props: { code: 'x' } }], [tie('k', 'v', 'lens')], new Map(), isView, new Map([['v', { style: { style: 'other' } }]]));
  assert.equal(held.size, 0);
});

test('a style about only what is archived is retired; one with no view yet, or that sets a page, stays', () => {
  const styles = [{ id: 'dead', props: { shape: 'flow' } }, { id: 'waits', props: { shape: 'flow' } }, { id: 'page', props: { theme: {} } }, { id: 'free', props: { shape: 'list' } }];
  const ties = [tie('dead', 'v', 'lens', true), tie('waits', 'item', 'project'), tie('page', 'doc', 'document')];
  const { held, retired } = stylesMoved(styles, ties, new Map(), isView, new Map());
  assert.equal(held.size, 0);
  assert.deepEqual(retired, ['dead']);
});
