// Where an agent's step lands among the owner's tabs and their panes (ui/pane-route.js), from whom each tab follows:
// decisions e_622ev534 (a place per session), e_nwmx4tbd (an agent's panes by name), e_y7uz9pk9 (changes as shows),
// and for tabs e_mzer5m4t (tabs at the top, each with its splits), e_q3amet26 (no most), e_xjrpyysn (a background tab
// when the reader is busy), and a pane of its own for each session, never the reader's in focus (the owner, 28 Oct 2026);
// only a show lands, and no tab is brought into sight (the owner, 29 Oct 2026, e_e7yfp2yg, e_jk63uduv).

import assert from 'node:assert/strict';
import { test } from 'node:test';
// A UI module, plain JavaScript with no types of its own.
const { followable, hear, heard, hearOpen, route } = (await import(`../ui/${'pane-route.js'}`)) as {
  followable: (open: Set<string> | null, at: { now: number; recent: number }) => string[];
  hear: (step: object) => void;
  heard: Map<string, { called: string }>;
  hearOpen: (open: object[]) => void;
  route: (step: object, tabs: object[], at: object) => unknown;
};

const now = 1_000_000;
const at = { now, recent: 600_000, settle: 30_000 };
type Pane = { id: string; slot?: string; held?: string; focus?: boolean; draws?: boolean; busy?: boolean; landed?: { session: string; at: number } };
/** A tab: its pane in focus (with `more` on it) and the panes beside it. */
const tab = (id: string, follows: string, more: Partial<Pane> = {}, beside: Pane[] = [], also = {}) => ({ id, follows, panes: [{ id: 'p0', focus: true, ...more }, ...beside], ...also });
const first = (more: Partial<Pane> = {}, beside: Pane[] = []) => tab('t0', 'all', more, beside, { front: true });
const step = (run: string, pane?: string) => ({ actor: 'agent:claude-code/archipelago', run, ...(pane && { pane }) });
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
  assert.deepEqual(route(step('e_bbbbbbbb'), tabs, at), { open: { follows: 'e_bbbbbbbb' }, front: false });
  assert.deepEqual(route(step('e_aaaaaaaa'), tabs, at), { tab: 't0', pane: 'p1', front: true });
  // With three tabs open, each session lands in its own and no other.
  const three = [first({}, [its('e_aaaaaaaa', 60_000)]), tab('t1', 'e_bbbbbbbb', held('e_bbbbbbbb', 50_000)), tab('t2', 'e_cccccccc', held('e_cccccccc', 40_000))];
  assert.deepEqual(route(step('e_bbbbbbbb'), three, at), { tab: 't1', pane: 'p0', front: false });
  assert.deepEqual(route(step('e_cccccccc'), three, at), { tab: 't2', pane: 'p0', front: false });
  // A fourth: there is no most.
  assert.deepEqual(route(step('e_dddddddd'), three, at), { open: { follows: 'e_dddddddd' }, front: false });
  // A session gone quiet lets go of the first tab, though its pane stays its own.
  assert.deepEqual(route(step('e_bbbbbbbb'), [first({}, [its('e_aaaaaaaa', 700_000)])], at), { tab: 't0', split: { side: 'right' }, front: true });
});

test('no tab is brought into sight: a show into another is drawn there, out of sight', () => {
  const tabs = [first({}, [its('e_aaaaaaaa', 5000)]), tab('t1', 'e_bbbbbbbb')];
  assert.deepEqual(route(step('e_bbbbbbbb'), tabs, at), { tab: 't1', pane: 'p0', front: false });
  assert.deepEqual(route(step('e_cccccccc'), tabs, at), { open: { follows: 'e_cccccccc' }, front: false });
  // The same session moving on in sight stays in sight.
  assert.deepEqual(route(step('e_aaaaaaaa'), tabs, at), { tab: 't0', pane: 'p1', front: true });
});

test('a tab that follows another or nobody never takes the step', () => {
  const tabs = [tab('t0', 'e_aaaaaaaa', {}, [], { front: true }), tab('t1', 'e_bbbbbbbb')];
  assert.deepEqual(route(step('e_bbbbbbbb'), tabs, at), { tab: 't1', pane: 'p0', front: false });
  // No tab follows everyone: a third session lands nowhere.
  assert.deepEqual(route(step('e_cccccccc'), tabs, at), { nowhere: true });
  assert.deepEqual(route(step('e_aaaaaaaa'), [tab('t0', 'none', {}, [], { front: true })], at), { nowhere: true });
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

test("a side moves the session's pane in its tab; alone and a page that is not a canvas only where the tab follows it", () => {
  assert.deepEqual(route(step('e_aaaaaaaa', 'left'), [first({}, [{ id: 'p1' }])], at), { tab: 't0', pane: 'p1', side: 'left', front: true });
  assert.deepEqual(route(step('e_aaaaaaaa', 'below'), [first()], at), { tab: 't0', split: { side: 'below' }, side: 'below', front: true });
  // Alone would close the reader's panes: in a tab that follows everyone it is the session's pane alone that moves.
  assert.deepEqual(route(step('e_aaaaaaaa', 'alone'), [first({}, [{ id: 'p1' }])], at), { tab: 't0', pane: 'p1', front: true });
  assert.deepEqual(route(step('e_aaaaaaaa', 'alone'), [tab('t0', 'e_aaaaaaaa', {}, [{ id: 'p1' }], { front: true })], at), { tab: 't0', pane: 'p0', side: 'alone', front: true });
  // `main`, from before every pane was alike, is the session's own pane.
  assert.deepEqual(route(step('e_aaaaaaaa', 'main'), [first({}, [its('e_aaaaaaaa')])], at), { tab: 't0', pane: 'p1', front: true });
  // A page that is not a canvas opens over no pane of the reader's: a tab of its own.
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({}, [its('e_aaaaaaaa')])], { ...at, drawable: false }), { open: { follows: 'e_aaaaaaaa' }, front: false });
  assert.deepEqual(route(step('e_aaaaaaaa'), [tab('t0', 'e_aaaaaaaa', {}, [], { front: true })], { ...at, drawable: false }), { tab: 't0', pane: 'p0', front: true });
});

test('a pane of its own moved into a tab that follows another is found there, but not in a tab that follows nobody', () => {
  const moved = [first(), tab('t1', 'e_bbbbbbbb', {}, [its('e_aaaaaaaa')])];
  assert.deepEqual(route(step('e_aaaaaaaa'), moved, at), { tab: 't1', pane: 'p1', front: false });
  const quiet = [first(), tab('t1', 'none', {}, [its('e_aaaaaaaa')])];
  assert.deepEqual(route(step('e_aaaaaaaa'), quiet, at), { tab: 't0', split: { side: 'right' }, front: true });
});

test('a tab can follow the sessions open now, not one that has ended', () => {
  heard.clear();
  hear({ actor: 'agent:a', run: 'e_ended000', name: 'Kos', at: 300 });
  hear({ actor: 'agent:a', run: 'e_working0', name: 'Mull', at: 200 });
  hear({ actor: 'agent:none', at: now - 1000 });
  hear({ actor: 'agent:long', at: now - 700_000 });
  const say = { now, recent: 600_000 };
  assert.deepEqual(followable(null, say), ['agent:none', 'agent:long', 'e_ended000', 'e_working0'], 'not yet asked: everyone heard');
  // A session open and quiet, which this page never heard from, can be followed too, by its name or its label.
  hearOpen([{ id: 'e_quiet000', name: 'Hoy', last_seen: new Date(100).toISOString() }, { id: 'e_titled00', name: 'Sark', label: 'Popups', last_seen: new Date(50).toISOString() }]);
  assert.deepEqual(followable(new Set(['e_working0', 'e_quiet000', 'e_titled00']), say), ['agent:none', 'e_working0', 'e_quiet000', 'e_titled00'], 'open, and an agent at work with no session');
  assert.deepEqual([heard.get('e_quiet000')!.called, heard.get('e_titled00')!.called], ['Session Hoy', 'Popups']);
  heard.clear();
});

test('within a tab, the pane drawing it already is lit, never the one in focus', () => {
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({}, [{ id: 'p1', draws: true }])], at), { tab: 't0', pane: 'p1', front: true });
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({ draws: true })], at), { tab: 't0', split: { side: 'right' }, front: true });
  // Nor a pane held for it that the reader has since touched.
  assert.deepEqual(route(step('e_aaaaaaaa'), [first(held('e_aaaaaaaa'))], at), { tab: 't0', split: { side: 'right' }, front: true });
  // Among tabs that follow everyone, the one drawing it.
  assert.deepEqual(route(step('e_aaaaaaaa'), [first(), tab('t1', 'all', {}, [{ id: 'p1', draws: true }])], at), { tab: 't1', pane: 'p1', front: false });
});

test('a pane the reader is busy in is passed by: a show opens a tab of its own in the background', () => {
  const busy = [first({ busy: true })];
  assert.deepEqual(route(step('e_aaaaaaaa'), busy, at), { open: { follows: 'e_aaaaaaaa' }, front: false });
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
  assert.deepEqual(route(step('e_aaaaaaaa'), [first(), tab('w1', 'e_aaaaaaaa', { busy: true }, [], { popped: true })], at), { open: { follows: 'e_aaaaaaaa' }, front: false });
  // A window that follows everyone is not taken: the show goes beside the reader's pane here.
  assert.deepEqual(route(step('e_aaaaaaaa'), [first(), tab('w1', 'all', {}, [], { popped: true })], at), { tab: 't0', split: { side: 'right' }, front: true });
});
