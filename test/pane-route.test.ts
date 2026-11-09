// Where an agent's step lands among the owner's tabs and their panes (ui/pane-route.js), from whom each tab follows:
// decisions e_622ev534 (a place per session), e_nwmx4tbd (an agent's panes by name), e_y7uz9pk9 (changes as shows),
// and for tabs e_mzer5m4t (tabs at the top, each with its splits), e_q3amet26 (no most), e_xjrpyysn (a background tab
// when the reader is busy), and a pane of its own for each session, never the reader's in focus (the owner, 28 Oct 2026);
// only a show lands, and no tab is brought into sight (the owner, 29 Oct 2026, e_e7yfp2yg, e_jk63uduv); every chat
// has a tab of its own and the owner's follow nobody unless they say (the tab lifecycle, e_p6fr4uye, e_jk6bnuh9).

import assert from 'node:assert/strict';
import { test } from 'node:test';
// A UI module, plain JavaScript with no types of its own.
const { followable, hear, heard, hearOpen, nameOf, route } = (await import(`../ui/${'pane-route.js'}`)) as {
  followable: (at: { now: number; recent: number }) => string[];
  nameOf: (key: string) => string;
  hear: (step: object) => void;
  heard: Map<string, { called: string; quiet?: boolean }>;
  hearOpen: (open: object[]) => void;
  route: (step: object, tabs: object[], at: object) => unknown;
};

const now = 1_000_000;
const at = {};
type Pane = { id: string; slot?: string; held?: string; by?: string; focus?: boolean; draws?: boolean; blank?: boolean; busy?: boolean; landed?: { session: string; at: number } };
/** A tab: its pane in focus (with `more` on it) and the panes beside it. */
const tab = (id: string, follows: string, more: Partial<Pane> = {}, beside: Pane[] = [], also = {}) => ({ id, follows, panes: [{ id: 'p0', focus: true, ...more }, ...beside], ...also });
/** The owner's tab in sight, following nobody. */
const first = (more: Partial<Pane> = {}, beside: Pane[] = []) => tab('t0', 'none', more, beside, { front: true });
/** A tab in sight following a chat. */
const chat = (run: string, more: Partial<Pane> = {}, beside: Pane[] = []) => tab('t0', run, more, beside, { front: true });
const step = (run: string, pane?: string) => ({ actor: 'agent:claude-code/archipelago', run, ...(pane && { pane }) });
/** A pane beside the one in focus, held for a session. */
const its = (session: string): Pane => ({ id: 'p1', held: session, landed: { session, at: now - 1000 } });

test("a chat with no tab gets one of its own, out of sight; the owner's tab is never taken", () => {
  assert.deepEqual(route(step('e_aaaaaaaa'), [first()], at), { open: { follows: 'e_aaaaaaaa' }, front: false });
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({}, [{ id: 'p1' }])], at), { open: { follows: 'e_aaaaaaaa' }, front: false }, "not a free pane of the owner's");
  // A page of the owner's tabs alone still takes a new chat; a tab the owner closed comes back with its next show.
  assert.deepEqual(route({ ...step('r1'), opens: true }, [first()], at), { open: { follows: 'r1' }, front: false });
  assert.deepEqual(route({ ...step('r1'), opens: true }, [first(), tab('t1', 'r1')], at), { tab: 't1', pane: 'p0', front: false }, 'it is not opened twice');
  // What the server says of a session (it began, took up a task) moves a tab it has, and opens none.
  assert.deepEqual(route({ ...step('r1'), opens: true, canvas: true }, [first()], at), { nowhere: true });
  assert.deepEqual(route({ ...step('r1'), canvas: true }, [first(), tab('t1', 'r1')], at), { tab: 't1', pane: 'p0', front: false });
});

test('several chats each keep a tab, and come back to it; there is no most', () => {
  const three = [first(), tab('t1', 'e_bbbbbbbb'), tab('t2', 'e_cccccccc')];
  assert.deepEqual(route(step('e_bbbbbbbb'), three, at), { tab: 't1', pane: 'p0', front: false });
  assert.deepEqual(route(step('e_cccccccc'), three, at), { tab: 't2', pane: 'p0', front: false });
  assert.deepEqual(route(step('e_dddddddd'), three, at), { open: { follows: 'e_dddddddd' }, front: false });
});

test('a tab following a chat takes its shows, in the pane held for it', () => {
  assert.deepEqual(route(step('e_aaaaaaaa'), [chat('e_aaaaaaaa')], at), { tab: 't0', pane: 'p0', front: true });
  assert.deepEqual(route(step('e_aaaaaaaa'), [chat('e_aaaaaaaa', {}, [its('e_aaaaaaaa')])], at), { tab: 't0', pane: 'p1', front: true });
});

test('one session keeps two panes by name in its tab, each drawn in again when named', () => {
  const tabs = [chat('e_aaaaaaaa', {}, [{ id: 'p1', slot: 'checks', by: 'e_aaaaaaaa' }])];
  assert.deepEqual(route(step('e_aaaaaaaa', 'checks'), tabs, at), { tab: 't0', pane: 'p1', front: true });
  assert.deepEqual(route(step('e_aaaaaaaa', 'map'), tabs, at), { tab: 't0', split: { slot: 'map', side: 'right' }, front: true });
  assert.deepEqual(route(step('e_bbbbbbbb', 'checks'), tabs, at), { open: { follows: 'e_bbbbbbbb', slot: 'checks' }, front: false });
  assert.deepEqual(route(step('e_bbbbbbbb', 'checks'), [...tabs, tab('t1', 'e_bbbbbbbb', { slot: 'checks' })], at), { tab: 't1', pane: 'p0', front: false });
});

test("a side moves the session's pane in its tab; alone and a page that is not a canvas only where the tab follows it", () => {
  assert.deepEqual(route(step('e_aaaaaaaa', 'left'), [chat('e_aaaaaaaa', {}, [{ id: 'p1' }])], at), { tab: 't0', pane: 'p0', side: 'left', front: true });
  assert.deepEqual(route(step('e_aaaaaaaa', 'alone'), [chat('e_aaaaaaaa', {}, [{ id: 'p1' }])], at), { tab: 't0', pane: 'p0', side: 'alone', front: true });
  // In a tab of the owner's that holds a pane of its own, alone moves nothing of theirs.
  assert.deepEqual(route(step('e_aaaaaaaa', 'alone'), [first({}, [its('e_aaaaaaaa')])], at), { tab: 't0', pane: 'p1', front: true });
  // A page that is not a canvas opens over no pane of the owner's: a tab of its own.
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({}, [its('e_aaaaaaaa')])], { drawable: false }), { open: { follows: 'e_aaaaaaaa' }, front: false });
  assert.deepEqual(route(step('e_aaaaaaaa'), [chat('e_aaaaaaaa')], { drawable: false }), { tab: 't0', pane: 'p0', front: true });
});

test('a pane of its own merged into another tab is found there, whoever that tab follows', () => {
  assert.deepEqual(route(step('e_aaaaaaaa'), [first(), tab('t1', 'e_bbbbbbbb', {}, [its('e_aaaaaaaa')])], at), { tab: 't1', pane: 'p1', front: false });
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({}, [{ id: 'p1', by: 'e_aaaaaaaa' }])], at), { tab: 't0', pane: 'p1', front: true });
  // A chat just begun still gets its own tab.
  assert.deepEqual(route({ ...step('e_aaaaaaaa'), opens: true }, [first({}, [its('e_aaaaaaaa')])], at), { open: { follows: 'e_aaaaaaaa' }, front: false });
  // Another chat's pane is never taken as a free one.
  assert.deepEqual(route(step('e_aaaaaaaa', 'left'), [chat('e_aaaaaaaa', {}, [{ id: 'p1', by: 'e_bbbbbbbb' }])], at), { tab: 't0', pane: 'p0', side: 'left', front: true });
});

test("a session is called by its chat's title, never by its word, and a tab can follow those open now", () => {
  heard.clear();
  hear({ actor: 'agent:a', run: 'e_ended000', name: 'Kos', title: 'Fix the solver', at: 300 });
  hear({ actor: 'agent:a', run: 'e_working0', name: 'Mull', at: 200 });
  hear({ actor: 'agent:none', at: now - 1000 });
  hear({ actor: 'agent:long', at: now - 700_000 });
  const say = { now, recent: 600_000 };
  assert.equal(nameOf('e_ended000'), 'Fix the solver');
  assert.equal(nameOf('e_working0'), 'a', "with no title yet, its agent's name, never its word");
  assert.deepEqual(followable(say), ['agent:none', 'e_ended000', 'e_working0']);
  hearOpen([
    { id: 'e_working0', title: 'Session in Apex repo', last_seen: new Date(200).toISOString() },
    { id: 'e_quiet000', name: 'Hoy', title: 'Quiet one', stale: true, last_seen: new Date(100).toISOString() },
  ]);
  assert.deepEqual(followable(say), ['agent:none', 'e_working0', 'e_quiet000'], 'open, and an agent at work with no session');
  assert.deepEqual([nameOf('e_working0'), nameOf('e_quiet000'), heard.get('e_quiet000')!.quiet], ['Session in Apex repo', 'Quiet one', true]);
  // A rename reaches the page with its next step; an end said is heard, and a start again.
  hear({ actor: 'agent:a', run: 'e_working0', title: 'Renamed', at: 500 });
  assert.equal(nameOf('e_working0'), 'Renamed');
  hear({ actor: 'agent:a', run: 'e_working0', ends: true, at: 600 });
  assert.ok(!followable(say).includes('e_working0'));
  hear({ actor: 'agent:a', run: 'e_working0', opens: true, at: 700 });
  assert.ok(followable(say).includes('e_working0'));
  // Two open by one title are told apart.
  hear({ actor: 'agent:a', run: 'e_twin0000', title: 'Quiet one', at: 800 });
  assert.equal(nameOf('e_twin0000'), 'Quiet one · 0000');
  heard.clear();
});

test("a pane the reader is busy in is passed by, and a chat's own tab the reader works in makes its show wait", () => {
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({ busy: true }), tab('t1', 'e_aaaaaaaa')], at), { tab: 't1', pane: 'p0', front: false });
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({ busy: true }, [its('e_aaaaaaaa')])], at), { tab: 't0', pane: 'p1', front: true });
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({}, [{ ...its('e_aaaaaaaa'), busy: true }])], at), { open: { follows: 'e_aaaaaaaa' }, front: false });
  const own = [first(), tab('t1', 'e_aaaaaaaa', { busy: true }, [], { front: true })];
  assert.deepEqual(route(step('e_aaaaaaaa'), own, at), { later: true });
  assert.deepEqual(route({ ...step('e_aaaaaaaa'), opens: true }, own, at), { later: true });
  assert.deepEqual(route(step('e_aaaaaaaa', 'review'), own, at), { later: true });
});

test('a tab popped out into a window of its own is drawn in its canvas, never brought into sight here', () => {
  assert.deepEqual(route(step('e_aaaaaaaa', 'review'), [first({ busy: true }), tab('w1', 'e_aaaaaaaa', {}, [], { popped: true })], at), { tab: 'w1', pane: 'p0', front: false });
  assert.deepEqual(route(step('e_aaaaaaaa'), [first(), tab('w1', 'e_aaaaaaaa', { busy: true }, [], { popped: true })], at), { later: true });
});

test('a show with focus brings its tab into sight, as the owner asked to be taken there (e_gt2rfab4)', () => {
  const focus = (run: string, pane?: string) => ({ ...step(run, pane), focus: true });
  assert.deepEqual(route(focus('e_aaaaaaaa'), [first()], at), { open: { follows: 'e_aaaaaaaa' }, front: true }, 'a tab of its own, opened in sight');
  assert.deepEqual(route(focus('e_aaaaaaaa', 'story'), [first(), tab('t1', 'e_aaaaaaaa', { slot: 'story' })], at), { tab: 't1', pane: 'p0', front: true }, 'its tab out of sight, brought into sight');
  assert.deepEqual(route(focus('e_aaaaaaaa'), [chat('e_aaaaaaaa')], at), { tab: 't0', pane: 'p0', front: true }, 'already in sight, it stays');
  assert.deepEqual(route(focus('e_aaaaaaaa'), [first(), tab('w1', 'e_aaaaaaaa', {}, [], { popped: true })], at), { tab: 'w1', pane: 'p0', front: false }, 'a window of its own is not a tab here');
});

test('a blank pane (a new tab, a split: no query) is taken before one is split beside it (e_33eqyryy)', () => {
  const run = 'e_aaaaaaaa';
  assert.deepEqual(route(step(run, 'story'), [chat(run, { blank: true })], at), { tab: 't0', pane: 'p0', slot: 'story', front: true }, 'a name asked for takes the blank pane in its tab, in focus too');
  assert.deepEqual(route(step(run), [chat(run, { blank: true, by: run })], at), { tab: 't0', pane: 'p0', front: true }, 'so does a show with no name');
  assert.deepEqual(route(step(run), [tab('t0', run, {}, [{ id: 'p1', blank: true }], { front: true })], at), { tab: 't0', pane: 'p0', front: true }, 'in its own tab every pane is its own: the one in focus first');
  assert.deepEqual(route(step(run, 'story'), [chat(run, { slot: 'review', blank: true })], at), { tab: 't0', split: { slot: 'story', side: 'right' }, front: true }, 'a named pane is no blank one to take');
  assert.deepEqual(route(step(run, 'story'), [chat(run, { blank: true, busy: true })], at), { later: true }, 'nor one the reader is busy in');
  assert.deepEqual(route(step(run, 'story'), [chat(run, { blank: true, held: 'e_bbbbbbbb' })], at), { tab: 't0', split: { slot: 'story', side: 'right' }, front: true }, 'nor one held for another');
});
