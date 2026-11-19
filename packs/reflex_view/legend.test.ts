import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legendOps, toggled } from './legend.js';

test('a toggle hides an entry when off and shows it again when on, each once', () => {
  assert.deepEqual(toggled(['tier:core'], 'kind:rule', false), ['tier:core', 'kind:rule']);
  assert.deepEqual(toggled(['tier:core', 'kind:rule'], 'kind:rule', false), ['tier:core', 'kind:rule']);
  assert.deepEqual(toggled(['tier:core', 'kind:rule'], 'kind:rule', true), ['tier:core']);
  assert.deepEqual(toggled(undefined, 'kind:rule', true), []);
});

test("a kept view's style takes the hidden list, the rest of it kept", () => {
  const kept = { id: 'e_view', props: { style: { layout: 'reflex_view.tree', sizes: { a: 1 }, hidden: ['tier:core'] } } };
  assert.deepEqual(legendOps({ view: 'e_view', entry: 'event:fired', on: false }, kept), { ops: [{ op: 'update', id: 'e_view', props: { style: { layout: 'reflex_view.tree', sizes: { a: 1 }, hidden: ['tier:core', 'event:fired'] } } }] });
});

test("a shipped view's first toggle makes the owner's version, with the style and query drawn", () => {
  const ops = legendOps({ view: 'reflex_view.tree', entry: 'pack:core', on: false, style: { layout: 'reflex_view.tree', title: 'Reflex tree' }, filter: { find: ['type instruction'] }, limit: 300 }, undefined);
  assert.deepEqual(ops, { ops: [{ op: 'create', type: 'lens', title: 'Reflex tree', props: { preset: 'reflex_view.tree', filter: { find: ['type instruction'] }, limit: 300, style: { layout: 'reflex_view.tree', title: 'Reflex tree', hidden: ['pack:core'] } } }] });
});

test('an entry the tree does not tell apart, or no on, is refused', () => {
  assert.throws(() => legendOps({ view: 'e_v', entry: 'colour:red', on: false }, { id: 'e_v', props: {} }), /entry is one of/);
  assert.throws(() => legendOps({ view: 'e_v', entry: 'kind:rule' }, { id: 'e_v', props: {} }), /on is true/);
});
