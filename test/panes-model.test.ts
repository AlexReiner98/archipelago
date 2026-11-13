// The panes pack's tab model (packs/panes/parts/model.js): tabs and panes as data, changed by what was asked, with no
// page. Run without a database or a browser.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a part's module, plain JavaScript
import * as M from '../packs/panes/parts/model.js';

const ids = () => {
  let n = 0;
  return (prefix: string) => `${prefix}${++n}`;
};

test('a pane opens beside the one in focus, and one already on the address is moved there', () => {
  const newId = ids();
  const t = M.freshTab(newId, 'v?f=a');
  const first = t.groups[0];
  const second = M.openPane(t, newId, 'v?f=b', 'right')!;
  assert.deepEqual(t.groups, [first, second]);
  assert.deepEqual(t.sizes, [0.5, 0.5]);
  assert.equal(M.openPane(t, newId, 'v?f=b', 'left', first), second, 'the pane on that address, moved');
  assert.deepEqual(t.groups, [second, first]);
  assert.equal(M.openPane(t, newId, 'workspace'), null, 'no pane draws a page that is no canvas');
  const below = M.openPane(t, newId, 'v?f=c', 'below', first)!;
  assert.equal(t.dir, 'column', 'a side across the direction turns the tab');
  assert.equal(t.groups.at(-1), below);
});

test('a pane keeps its own back and forth, and the last pane stays', () => {
  const newId = ids();
  const t = M.freshTab(newId, 'v?f=a');
  const p = t.groups[0];
  assert.equal(M.goPane(t, p, 'v?f=b'), true);
  assert.equal(M.goPane(t, p, 'v?f=b'), false, 'no step to where it stands');
  assert.equal(M.travel(t, p, -1), true);
  assert.equal(t.panes[p].at, 'v?f=a');
  assert.equal(M.travel(t, p, -1), false);
  assert.equal(M.travel(t, p, 1), true);
  assert.equal(t.panes[p].at, 'v?f=b');
  assert.equal(M.closePane(t, p), false, 'the last pane stays');
});

test('a drag docks a pane on a side, swaps it in the middle, and a line shares the room', () => {
  const newId = ids();
  const t = M.freshTab(newId, 'v?f=a');
  const [a] = t.groups;
  const b = M.openPane(t, newId, 'v?f=b')!;
  const c = M.openPane(t, newId, 'v?f=c', 'right', b)!;
  assert.equal(M.dropPane(t, c, a, 'center'), true);
  assert.deepEqual(t.groups, [c, b, a]);
  assert.equal(M.dropPane(t, a, c, 'left'), true);
  assert.deepEqual(t.groups, [a, c, b]);
  M.share(t, 0, 0.9);
  assert.ok(t.sizes[0] < 2 / 3 && t.sizes[1] > 0, 'a pane keeps at least its least');
  assert.ok(Math.abs(t.sizes.reduce((x: number, y: number) => x + y, 0) - 1) < 1e-9);
});

test('tabs open, join, split off and close, the owner keeping one of theirs', () => {
  const newId = ids();
  const m = M.model([M.freshTab(newId, 'v?f=a')]);
  const home = m.front!;
  const other = M.openTab(m, newId, 'v?f=b', {}, false);
  assert.equal(m.front, home, 'opened out of sight');
  assert.equal(M.tabOf(m, other)!.unseen, true);
  M.joinTab(m, M.tabOf(m, other)!, M.tabOf(m, home)!);
  assert.equal(m.list.length, 1, 'a tab left with no pane goes');
  const t = M.frontOf(m);
  assert.equal(t.groups.length, 2);
  const split = M.paneToTab(m, newId, t.groups[1])!;
  assert.equal(m.front, split);
  assert.equal(m.list.length, 2);
  assert.equal(M.closeTab(m, split), true);
  assert.equal(m.front, home);
  assert.equal(M.closeTab(m, home), false, "the owner's last tab stays");
});

test("a show lands in the tab that follows its session, or holds its pane, and a chat's tab is the owner's once kept", () => {
  const newId = ids();
  const m = M.model([M.freshTab(newId, 'v'), M.freshTab(newId, 'v', { held: 'e_run00001' })]);
  const [mine, held] = m.list;
  assert.deepEqual(M.landsIn(m, mine), []);
  assert.deepEqual(M.landsIn(m, held), ['e_run00001']);
  mine.follows = 'e_run00001';
  assert.deepEqual(M.landsIn(m, held), [], 'one another tab follows is not held here');
  const chat = M.tabOf(m, M.openTab(m, newId, 'v', { by: 'e_run00002', chat: 'e_run00002' } as never))!;
  assert.equal(M.closable(m, chat), true);
  M.keepTab(chat);
  assert.equal(chat.chat, undefined);
  assert.equal(chat.panes[chat.groups[0]].by, undefined);
});

test('addresses: a pane draws a canvas, an item or a web page, and the page reads back to it', () => {
  assert.equal(M.asPane('#/v?f=a'), 'v?f=a');
  assert.equal(M.hrefOf('v'), '#/');
  assert.equal(M.atOf('#/'), 'v');
  assert.equal(M.atOf('#/w?url=https%3A%2F%2Fa.b'), 'w?url=https%3A%2F%2Fa.b');
  assert.equal(M.atOf('#/workspace'), undefined);
  assert.equal(M.webOf('w?url=https%3A%2F%2Fa.b'), 'https://a.b');
  assert.equal(M.named('v?canvas=e_abcdefgh&x=1'), 'e_abcdefgh');
  const t = { ...M.freshTab(ids(), 'v?f=a'), sheet: 'e/e_abcdefgh' };
  assert.equal(M.tabHref(t), '#/e/e_abcdefgh?f=a');
});

test("a chat's tab carries the mark of its session's state, and in its tip what it waits for", async () => {
  // @ts-ignore: a part's module, plain JavaScript
  const { strip } = await import('../packs/panes/parts/strip.js');
  const newId = ids();
  const t = { ...M.freshTab(newId, 'v'), follows: 'e_run00001', chat: 'e_run00001' };
  const said = JSON.stringify(strip(M.model([M.freshTab(newId, 'v'), t]), { sessions: { e_run00001: { name: 'Chat', state: 'waiting', for: 'a review' } } }));
  assert.match(said, /"look":"mark","tip":"waits on you: a review"\},"\?"/);
  assert.doesNotMatch(JSON.stringify(strip(M.model([t]), { sessions: { e_run00001: { name: 'Chat', state: 'working' } } })), /"look":"mark"/, 'working draws no mark');
});
