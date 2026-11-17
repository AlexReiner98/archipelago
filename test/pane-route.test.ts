// Where an agent's show lands among the owner's tabs (the panes part's rule, packs/panes/parts/route.js; the sessions
// heard, packs/surface/page/pane-route.js): a tab is one canvas (Alex, 17 Nov 2026), every chat has a tab of its own
// (the tab lifecycle, e_p6fr4uye), only a show lands and no tab is brought into sight but by one with focus
// (e_e7yfp2yg, e_gt2rfab4), and a tab the reader works in makes the show wait (e_xjrpyysn).

import assert from 'node:assert/strict';
import { test } from 'node:test';
// A UI module, plain JavaScript with no types of its own.
const { route } = (await import(`../packs/panes/parts/${'route.js'}`)) as { route: (step: object, tabs: object[]) => unknown };
const { hear, heard, hearOpen, nameOf } = (await import(`../packs/surface/page/${'pane-route.js'}`)) as {
  nameOf: (key: string) => string;
  hear: (step: object) => void;
  heard: Map<string, { called: string; quiet?: boolean }>;
  hearOpen: (open: object[]) => void;
};

const now = 1_000_000;

/** A tab: whom it follows, in sight or busy as said. */
const tab = (id: string, follows: string, also = {}) => ({ id, follows, ...also });
/** The owner's tab in sight, following nobody. */
const first = (also = {}) => tab('t0', 'none', { front: true, ...also });
const step = (run: string) => ({ actor: 'agent:claude-code/archipelago', run });

test("a chat with no tab gets one of its own, out of sight; the owner's tab is never taken", () => {
  assert.deepEqual(route(step('e_aaaaaaaa'), [first()]), { open: { follows: 'e_aaaaaaaa' }, front: false });
  assert.deepEqual(route({ ...step('r1'), opens: true }, [first(), tab('t1', 'r1')]), { tab: 't1', front: false }, 'it is not opened twice');
  // What the server says of a session (it began, took up a task) moves a tab it has, and opens none.
  assert.deepEqual(route({ ...step('r1'), opens: true, canvas: true }, [first()]), { nowhere: true });
  assert.deepEqual(route({ ...step('r1'), canvas: true }, [first(), tab('t1', 'r1')]), { tab: 't1', front: false });
});

test('several chats each keep a tab, and come back to it; there is no most', () => {
  const three = [first(), tab('t1', 'e_bbbbbbbb'), tab('t2', 'e_cccccccc')];
  assert.deepEqual(route(step('e_bbbbbbbb'), three), { tab: 't1', front: false });
  assert.deepEqual(route(step('e_cccccccc'), three), { tab: 't2', front: false });
  assert.deepEqual(route(step('e_dddddddd'), three), { open: { follows: 'e_dddddddd' }, front: false });
});

test("a session is called by its chat's title, never by its word", () => {
  heard.clear();
  hear({ actor: 'agent:a', run: 'e_ended000', name: 'Kos', title: 'Fix the solver', at: 300 });
  hear({ actor: 'agent:a', run: 'e_working0', name: 'Mull', at: 200 });
  hear({ actor: 'agent:none', at: now - 1000 });
  hear({ actor: 'agent:long', at: now - 700_000 });
  assert.equal(nameOf('e_ended000'), 'Fix the solver');
  assert.equal(nameOf('e_working0'), 'a', "with no title yet, its agent's name, never its word");
  hearOpen([
    { id: 'e_working0', title: 'Session in Apex repo', last_seen: new Date(200).toISOString() },
    { id: 'e_quiet000', name: 'Hoy', title: 'Quiet one', stale: true, last_seen: new Date(100).toISOString() },
  ]);
  assert.deepEqual([nameOf('e_working0'), nameOf('e_quiet000'), heard.get('e_quiet000')!.quiet], ['Session in Apex repo', 'Quiet one', true]);
  // A rename reaches the page with its next step.
  hear({ actor: 'agent:a', run: 'e_working0', title: 'Renamed', at: 500 });
  assert.equal(nameOf('e_working0'), 'Renamed');
  // Two open by one title are told apart.
  hear({ actor: 'agent:a', run: 'e_twin0000', title: 'Quiet one', at: 800 });
  assert.equal(nameOf('e_twin0000'), 'Quiet one · 0000');
  heard.clear();
});

test("a chat's own tab the reader works in makes its show wait; the owner's busy tab is passed by", () => {
  assert.deepEqual(route(step('e_aaaaaaaa'), [first({ busy: true }), tab('t1', 'e_aaaaaaaa')]), { tab: 't1', front: false });
  const own = [first(), tab('t1', 'e_aaaaaaaa', { busy: true, front: true })];
  assert.deepEqual(route(step('e_aaaaaaaa'), own), { later: true });
  assert.deepEqual(route({ ...step('e_aaaaaaaa'), opens: true }, own), { later: true });
});

test('a show with focus brings its tab into sight, as the owner asked to be taken there (e_gt2rfab4)', () => {
  const focus = (run: string) => ({ ...step(run), focus: true });
  assert.deepEqual(route(focus('e_aaaaaaaa'), [first()]), { open: { follows: 'e_aaaaaaaa' }, front: true }, 'a tab of its own, opened in sight');
  assert.deepEqual(route(focus('e_aaaaaaaa'), [first(), tab('t1', 'e_aaaaaaaa')]), { tab: 't1', front: true }, 'its tab out of sight, brought into sight');
});
