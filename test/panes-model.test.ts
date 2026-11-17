// The panes pack's tab model (packs/panes/parts/model.js): tabs as data, each one canvas, changed by what was asked, with no
// page. Run without a database or a browser.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a part's module, plain JavaScript
import * as M from '../packs/panes/parts/model.js';

const ids = () => {
  let n = 0;
  return (prefix: string) => `${prefix}${++n}`;
};

test('a tab kept from when it held several panes is cut to its pane in focus', () => {
  const newId = ids();
  const t = M.freshTab(newId, 'v?f=a');
  t.panes.p9 = M.freshPane('v?f=b');
  Object.assign(t, { groups: [t.groups[0], 'p9'], sizes: [0.5, 0.5], focus: 'p9' });
  M.alone(t);
  assert.deepEqual(t.groups, ['p9']);
  assert.deepEqual(t.sizes, [1]);
  assert.deepEqual(Object.keys(t.panes), ['p9']);
});

test('a tab keeps its own back and forth', () => {
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
});

test('tabs open and close, the owner keeping one of theirs', () => {
  const newId = ids();
  const m = M.model([M.freshTab(newId, 'v?f=a')]);
  const home = m.front!;
  const other = M.openTab(m, newId, 'v?f=b', {}, false);
  assert.equal(m.front, home, 'opened out of sight');
  assert.equal(M.tabOf(m, other)!.unseen, true);
  assert.equal(M.toFront(m, other), true);
  assert.equal(M.closeTab(m, other), true);
  assert.equal(m.front, home);
  assert.equal(M.closeTab(m, home), false, "the owner's last tab stays");
});

test("a show lands in the tab that follows its session; a chat's tab can be closed", () => {
  const newId = ids();
  const m = M.model([M.freshTab(newId, 'v')]);
  const [mine] = m.list;
  assert.deepEqual(M.landsIn(m, mine), []);
  mine.follows = 'e_run00001';
  assert.deepEqual(M.landsIn(m, mine), ['e_run00001']);
  const chat = M.tabOf(m, M.openTab(m, newId, 'v', { by: 'e_run00002', chat: 'e_run00002', follows: 'e_run00002' } as never))!;
  assert.deepEqual(M.landsIn(m, chat), ['e_run00002']);
  assert.equal(M.closable(m, chat), true);
});

test('addresses: a pane draws a canvas, an item or a web page, and the page reads back to it', () => {
  assert.equal(M.asPane('#/v?f=a'), 'v?f=a');
  assert.equal(M.hrefOf('v'), '#/');
  assert.equal(M.atOf('#/'), 'v');
  assert.equal(M.atOf('#/e/e_abcdefgh?islands=e_bbbbbbbb'), 'v?islands=e_bbbbbbbb', 'an item over a list of islands');
  assert.equal(M.atOf('#/w?url=https%3A%2F%2Fa.b'), 'w?url=https%3A%2F%2Fa.b');
  assert.equal(M.atOf('#/workspace'), undefined);
  assert.equal(M.webOf('w?url=https%3A%2F%2Fa.b'), 'https://a.b');
  assert.equal(M.named('v?canvas=e_abcdefgh&x=1'), 'e_abcdefgh');
  const t = { ...M.freshTab(ids(), 'v?f=a'), sheet: 'e/e_abcdefgh' };
  assert.equal(M.tabHref(t), '#/e/e_abcdefgh?f=a');
});

test("each tab opens tab.mark, handed the tab, the one in sight, and its session's state and what it waits for", async () => {
  // @ts-ignore: a part's module, plain JavaScript
  const { strip } = await import('../packs/panes/parts/strip.js');
  const newId = ids();
  const mine = M.freshTab(newId, 'v');
  const t = { ...M.freshTab(newId, 'v'), follows: 'e_run00001', chat: 'e_run00001' };
  const m = M.model([mine, t]);
  const slots: { name: string; piece: Record<string, string> }[] = [];
  const walk = (x: unknown): void => void (Array.isArray(x) && (x[0] === 'slot' ? slots.push(x[1]) : x.slice(1).forEach(walk)));
  walk(strip(m, { sessions: { e_run00001: { name: 'Chat', state: 'waiting', for: 'a review' } } }));
  assert.deepEqual(slots.map((x) => x.name), ['tab.mark', 'tab.mark'], 'one for each tab');
  assert.deepEqual(slots[0].piece, { tab: mine.id, current: m.front });
  assert.deepEqual(slots[1].piece, { tab: t.id, current: m.front, state: 'waiting', for: 'a review' });
});
