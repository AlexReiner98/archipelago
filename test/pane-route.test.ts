// Where an agent's step lands among the owner's tabs and their panes (ui/pane-route.js), from whom each tab follows:
// decisions e_622ev534 (a place per session), e_nwmx4tbd (an agent's panes by name), e_y7uz9pk9 (changes as shows),
// and for tabs e_mzer5m4t (tabs at the top, each with its splits), e_q3amet26 (no most), e_xjrpyysn (a background tab
// when the reader is busy), and a pane of its own for each session, never the reader's in focus (the owner, 28 Oct 2026).

import assert from 'node:assert/strict';
import { test } from 'node:test';
// A UI module, plain JavaScript with no types of its own.
const { route } = (await import(`../ui/${'pane-route.js'}`)) as { route: (step: object, tabs: object[], at: object) => unknown };

const now = 1_000_000;
const at = { now, recent: 600_000, settle: 30_000 };
type Pane = { id: string; slot?: string; held?: string; focus?: boolean; draws?: boolean; busy?: boolean; landed?: { session: string; at: number } };
/** A tab: its pane in focus (with `more` on it) and the panes beside it. */
const tab = (id: string, follows: string, more: Partial<Pane> = {}, beside: Pane[] = [], also = {}) => ({ id, follows, panes: [{ id: 'p0', focus: true, ...more }, ...beside], ...also });
const first = (more: Partial<Pane> = {}, beside: Pane[] = []) => tab('t0', 'all', more, beside, { front: true });
const step = (run: string, pane?: string, kind?: string) => ({ actor: 'agent:claude-code/archipelago', run, ...(pane && { pane }), ...(kind && { kind }) });
/** A pane held for a session that landed there `ago`. */
const held = (session: string, ago = 1000) => ({ held: session, landed: { session, at: now - ago } });
/** A pane beside the one in focus, held for a session. */
const its = (session: string, ago = 1000): Pane => ({ id: 'p1', ...held(session, ago) });

test('one session alone gets a pane of its own beside the one in focus, and keeps it', () => {
  assert.deepEqual(route(step('e_aaaaaaaa'), [first()], at), { tab: 't0', split: { side: 'right' }, front: true });
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({}, [its('e_aaaaaaaa', 3_000_000)])], at), { tab: 't0', pane: 'p1', front: true });
  // A pane beside that nobody holds is taken before another is split.
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({}, [{ id: 'p1' }])], at), { tab: 't0', pane: 'p1', front: true });
});

test('several sessions of one agent each keep a tab, and come back to it', () => {
  // A second session at work gets a tab of its own; the first keeps its own.
  const tabs = [first({}, [its('e_aaaaaaaa', 60_000)])];
  assert.deepEqual(route(step('e_bbbbbbbb'), tabs, at), { open: { follows: 'e_bbbbbbbb' }, front: true });
  assert.deepEqual(route(step('e_aaaaaaaa'), tabs, at), { tab: 't0', pane: 'p1', front: true });
  // With three tabs open, each session lands in its own and no other.
  const three = [first({}, [its('e_aaaaaaaa', 60_000)]), tab('t1', 'e_bbbbbbbb', held('e_bbbbbbbb', 50_000)), tab('t2', 'e_cccccccc', held('e_cccccccc', 40_000))];
  assert.deepEqual(route(step('e_bbbbbbbb'), three, at), { tab: 't1', pane: 'p0', front: true });
  assert.deepEqual(route(step('e_cccccccc'), three, at), { tab: 't2', pane: 'p0', front: true });
  // A fourth: there is no most.
  assert.deepEqual(route(step('e_dddddddd'), three, at), { open: { follows: 'e_dddddddd' }, front: true });
  // A session gone quiet lets go of the first tab, though its pane stays its own.
  assert.deepEqual(route(step('e_bbbbbbbb'), [first({}, [its('e_aaaaaaaa', 700_000)])], at), { tab: 't0', split: { side: 'right' }, front: true });
});

test('a tab comes into sight unless another session has just shown in the one in sight', () => {
  const tabs = [first({}, [its('e_aaaaaaaa', 5000)]), tab('t1', 'e_bbbbbbbb')];
  assert.deepEqual(route(step('e_bbbbbbbb'), tabs, at), { tab: 't1', pane: 'p0', front: false });
  assert.deepEqual(route(step('e_cccccccc'), tabs, at), { open: { follows: 'e_cccccccc' }, front: false });
  // The same session moving on in sight stays in sight.
  assert.deepEqual(route(step('e_aaaaaaaa'), tabs, at), { tab: 't0', pane: 'p1', front: true });
});

test('a tab that follows another or nobody never takes the step', () => {
  const tabs = [tab('t0', 'e_aaaaaaaa', {}, [], { front: true }), tab('t1', 'e_bbbbbbbb')];
  assert.deepEqual(route(step('e_bbbbbbbb'), tabs, at), { tab: 't1', pane: 'p0', front: true });
  // No tab follows everyone: a third session is only offered.
  assert.deepEqual(route(step('e_cccccccc'), tabs, at), { offer: true });
  assert.deepEqual(route(step('e_aaaaaaaa'), [tab('t0', 'none', {}, [], { front: true })], at), { offer: true });
});

test('one session keeps two panes by name in its tab, each drawn in again when named', () => {
  const tabs = [first({}, [{ id: 'p1', slot: 'tests', landed: { session: 'e_aaaaaaaa', at: now - 1000 } }])];
  assert.deepEqual(route(step('e_aaaaaaaa', 'tests'), tabs, at), { tab: 't0', pane: 'p1', front: true });
  assert.deepEqual(route(step('e_aaaaaaaa', 'map'), tabs, at), { tab: 't0', split: { slot: 'map', side: 'right' }, front: true });
  // Another session's pane of the same name is not this one's: the first tab is held, so a tab of its own, by that name.
  assert.deepEqual(route(step('e_bbbbbbbb', 'tests'), tabs, at), { open: { follows: 'e_bbbbbbbb', slot: 'tests' }, front: false });
  // A tab opened by name keeps the name on its pane.
  assert.deepEqual(route(step('e_bbbbbbbb', 'tests'), [...tabs, tab('t1', 'e_bbbbbbbb', { slot: 'tests' })], at), { tab: 't1', pane: 'p0', front: false });
});

test("a side moves the session's pane in its tab; a page that is not a canvas opens over the pane in focus", () => {
  assert.deepEqual(route(step('e_aaaaaaaa', 'left'), [first({}, [{ id: 'p1' }])], at), { tab: 't0', pane: 'p1', side: 'left', front: true });
  assert.deepEqual(route(step('e_aaaaaaaa', 'below'), [first()], at), { tab: 't0', split: { side: 'below' }, side: 'below', front: true });
  assert.deepEqual(route(step('e_aaaaaaaa', 'alone'), [first({}, [{ id: 'p1' }])], at), { tab: 't0', pane: 'p1', side: 'alone', front: true });
  // `main`, from before every pane was alike, is the session's own pane.
  assert.deepEqual(route(step('e_aaaaaaaa', 'main'), [first({}, [its('e_aaaaaaaa')])], at), { tab: 't0', pane: 'p1', front: true });
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({}, [its('e_aaaaaaaa')])], { ...at, drawable: false }), { tab: 't0', pane: 'p0', front: true });
});

test('within a tab, the pane drawing it already is lit, the one in focus too', () => {
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({}, [{ id: 'p1', draws: true }])], at), { tab: 't0', pane: 'p1', front: true });
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({ draws: true })], at), { tab: 't0', pane: 'p0', front: true });
  // Among tabs that follow everyone, the one drawing it.
  assert.deepEqual(route(step('e_aaaaaaaa'), [first(), tab('t1', 'all', { draws: true })], at), { tab: 't1', pane: 'p0', front: true });
});

test('a change moves no tab its session has not shown into while others are at work, and brings none into sight', () => {
  const change = (run: string) => step(run, undefined, 'change');
  assert.deepEqual(route(change('e_cccccccc'), [first()], { ...at, others: 2 }), { offer: true });
  assert.deepEqual(route(change('e_cccccccc'), [first(), tab('t1', 'e_cccccccc')], { ...at, others: 2 }), { tab: 't1', pane: 'p0', front: false });
  assert.deepEqual(route(change('e_cccccccc'), [first({}, [its('e_cccccccc')])], { ...at, others: 2 }), { tab: 't0', pane: 'p1', front: true });
  // Alone at work, its change goes where a show would, but opens nothing: with no pane of its own yet, it is offered.
  assert.deepEqual(route(change('e_aaaaaaaa'), [first({}, [its('e_aaaaaaaa')])], at), { tab: 't0', pane: 'p1', front: true });
  assert.deepEqual(route(change('e_aaaaaaaa'), [first()], at), { offer: true });
  assert.deepEqual(route(change('e_aaaaaaaa'), [first({}, [its('e_bbbbbbbb')])], at), { offer: true });
  assert.deepEqual(route({ ...change('e_aaaaaaaa'), pane: 'map' }, [first()], at), { offer: true });
});

test('a pane the reader is busy in is passed by: a show opens a tab of its own in the background, a change is offered', () => {
  const busy = [first({ busy: true })];
  assert.deepEqual(route(step('e_aaaaaaaa'), busy, at), { open: { follows: 'e_aaaaaaaa' }, front: false });
  assert.deepEqual(route(step('e_aaaaaaaa', undefined, 'change'), busy, at), { offer: true });
  // No pane is split into a tab the reader is at work in.
  assert.deepEqual(route(step('e_aaaaaaaa', 'review'), busy, at), { open: { follows: 'e_aaaaaaaa', slot: 'review' }, front: false });
  // A session's own tab is drawn in the background while the reader works in another.
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({ busy: true }), tab('t1', 'e_aaaaaaaa')], at), { tab: 't1', pane: 'p0', front: false });
  // A busy pane elsewhere in the tab does not stop a show into the session's own pane there.
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({ busy: true }, [its('e_aaaaaaaa')])], at), { tab: 't0', pane: 'p1', front: true });
  // Its own pane busy: a tab of its own.
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({}, [{ ...its('e_aaaaaaaa'), busy: true }])], at), { open: { follows: 'e_aaaaaaaa' }, front: false });
});

test('a tab popped out into a window of its own is drawn in its canvas, never brought into sight here', () => {
  const out = [first({ busy: true }), tab('w1', 'e_aaaaaaaa', {}, [], { popped: true })];
  assert.deepEqual(route(step('e_aaaaaaaa', 'review'), out, at), { tab: 'w1', pane: 'p0', front: false });
  // A window the reader is at work in is passed by too.
  assert.deepEqual(route(step('e_aaaaaaaa'), [first(), tab('w1', 'e_aaaaaaaa', { busy: true }, [], { popped: true })], at), { open: { follows: 'e_aaaaaaaa' }, front: true });
});
