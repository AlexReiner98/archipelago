// Where an agent's step lands among the owner's panes (ui/pane-route.js), from whom each pane follows: decisions
// e_622ev534 (a new pane per session), e_nwmx4tbd (an agent's panes by name) and e_y7uz9pk9 (changes as shows).

import assert from 'node:assert/strict';
import { test } from 'node:test';
// A UI module, plain JavaScript with no types of its own.
const { route } = (await import(`../ui/${'pane-route.js'}`)) as { route: (step: object, panes: object[], at: object) => unknown };

const now = 1_000_000;
const at = { now, recent: 600_000, most: 4 };
const main = (more = {}) => ({ id: 'main', follows: 'all', ...more });
const step = (run: string, pane?: string) => ({ actor: 'agent:claude-code/archipelago', run, ...(pane && { pane }) });

test('one session alone takes the main canvas, as before there were sessions', () => {
  assert.deepEqual(route(step('e_aaaaaaaa'), [main()], at), { pane: 'main' });
});

test('a second session at work gets a pane of its own; the first keeps main', () => {
  const panes = [main({ landed: { session: 'e_aaaaaaaa', at: now - 1000 } })];
  assert.deepEqual(route(step('e_bbbbbbbb'), panes, at), { open: { follows: 'e_bbbbbbbb', side: 'right' } });
  assert.deepEqual(route(step('e_aaaaaaaa'), panes, at), { pane: 'main' });
  // A session gone quiet lets go of main.
  assert.deepEqual(route(step('e_bbbbbbbb'), [main({ landed: { session: 'e_aaaaaaaa', at: now - 700_000 } })], at), { pane: 'main' });
});

test('a session lands in the pane that follows it, and one following another never takes its steps', () => {
  const panes = [main({ follows: 'e_aaaaaaaa' }), { id: 'p1', follows: 'e_bbbbbbbb' }];
  assert.deepEqual(route(step('e_bbbbbbbb'), panes, at), { pane: 'p1' });
  assert.deepEqual(route(step('e_aaaaaaaa'), panes, at), { pane: 'main' });
  // No pane follows everyone: a third session is only offered.
  assert.deepEqual(route(step('e_cccccccc'), panes, at), { offer: true });
});

test('one session keeps two panes by name, each drawn in again when named', () => {
  const panes = [main({ landed: { session: 'e_aaaaaaaa', at: now } }), { id: 'p1', follows: 'e_aaaaaaaa', slot: 'tests' }];
  assert.deepEqual(route(step('e_aaaaaaaa', 'tests'), panes, at), { pane: 'p1' });
  assert.deepEqual(route(step('e_aaaaaaaa', 'map'), panes, at), { open: { follows: 'e_aaaaaaaa', slot: 'map', side: 'right' } });
  // Another session's pane of the same name is not this one's.
  assert.deepEqual(route(step('e_bbbbbbbb', 'tests'), panes, at), { open: { follows: 'e_bbbbbbbb', slot: 'tests', side: 'right' } });
});

test('a pane that follows nobody is never moved; past the most panes a step is only offered', () => {
  assert.deepEqual(route(step('e_aaaaaaaa'), [main({ follows: 'none' })], at), { offer: true });
  const full = [main({ landed: { session: 'e_x', at: now } }), ...['p1', 'p2', 'p3'].map((id) => ({ id, follows: `e_${id}` }))];
  assert.deepEqual(route(step('e_bbbbbbbb'), full, at), { offer: true });
});

test('a side moves the session\'s pane there; what only the main canvas draws goes there or is offered', () => {
  assert.deepEqual(route(step('e_aaaaaaaa', 'left'), [main(), { id: 'p1', follows: 'e_aaaaaaaa' }], at), { pane: 'p1', side: 'left' });
  assert.deepEqual(route(step('e_aaaaaaaa', 'below'), [main()], at), { open: { follows: 'e_aaaaaaaa', side: 'below' } });
  assert.deepEqual(route(step('e_aaaaaaaa'), [main(), { id: 'p1', follows: 'e_aaaaaaaa' }], { ...at, drawable: false }), { pane: 'main' });
  assert.deepEqual(route(step('e_aaaaaaaa'), [main({ follows: 'e_bbbbbbbb' })], { ...at, drawable: false }), { offer: true });
});

test('among panes that follow everyone, the one drawing it already is lit', () => {
  assert.deepEqual(route(step('e_aaaaaaaa'), [main(), { id: 'p1', follows: 'all', draws: true }], at), { pane: 'p1' });
});

test('a change moves no pane its session has not shown into while others are at work', () => {
  const change = { ...step('e_cccccccc'), kind: 'change' };
  assert.deepEqual(route(change, [main()], { ...at, others: 2 }), { offer: true });
  assert.deepEqual(route(change, [main(), { id: 'p1', follows: 'e_cccccccc' }], { ...at, others: 2 }), { pane: 'p1' });
  assert.deepEqual(route(change, [main({ landed: { session: 'e_cccccccc', at: now } })], { ...at, others: 2 }), { pane: 'main' });
  // Alone at work, its change goes where a show would.
  assert.deepEqual(route(change, [main()], at), { pane: 'main' });
});
