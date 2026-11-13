// The marks the walled roots asked for (packs/walls/page/part-check.js), and the host's pure workings behind them, without
// a page: a menu's steps and how a field narrows them, a box that fits and its +N, lights, a web page framed, panes with
// their canvases and the lines between them, a drag and where it lands, a tab's looks.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: modules of the page, plain JavaScript
import { checkMarks, isChecked, DROP_ZONES } from '../packs/walls/page/part-check.js';
// @ts-ignore
import { fitCount } from '../packs/walls/page/part-fits.js';
// @ts-ignore
import { kept } from '../packs/walls/page/part-menu.js';
// @ts-ignore
import { webOf, SANDBOX } from '../packs/walls/page/part-pane.js';
// @ts-ignore
import { zoneOf, zoneBox } from '../packs/walls/page/part-drag.js';

const refused = (mark: unknown, said: RegExp) => assert.throws(() => checkMarks(mark), (e: Error) => said.test(e.message) && /cannot be drawn/.test(e.message));

test('a menu holds steps: a head, a field that narrows, buttons and a menu that leads on', () => {
  const m = checkMarks(['menu', { key: 'add', label: 'Add', open: true },
    ['text', { look: 'muted' }, 'Add a term'],
    ['input', { key: 'q', kind: 'search', hint: 'Find a kind' }],
    ['button', { key: 'task' }, 'Task'],
    ['menu', { key: 'more', label: 'More kinds' }, ['button', { key: 'decision' }, 'Decision'], ['input', { key: 'w', kind: 'text' }]],
    ['input', { key: 'it', kind: 'item' }],
  ]);
  assert.ok(isChecked(m));
  assert.equal(m.at.open, true);
  assert.equal(m.kids[3].mark, 'menu');
  assert.equal(m.kids[3].kids[0].key, 'decision');
  refused(['menu', { label: 'x' }, ['paint', { width: 1, height: 1 }]], /a paint in a menu/);
  refused(['menu', { label: 'x', open: 'yes' }], /open: not true or false/);
  // What a field keeps, a case apart; nothing typed keeps everything.
  assert.deepEqual(kept(['Task', 'Decision', 'Tasklet'], 'TASK'), ['Task', 'Tasklet']);
  assert.deepEqual(kept(['Task', 'Decision'], '  '), ['Task', 'Decision']);
});

test('a box that fits counts what is left, and its +N may go back by a key', () => {
  const b = checkMarks(['box', { flow: 'row', fits: true, more: 'terms-more' }, ['text', 'a'], ['text', 'b']]);
  assert.equal(b.at.more, 'terms-more');
  refused(['box', { more: 'x' }], /more on a box that does not fit/);
  refused(['box', { fits: true, more: 'x' }, ['button', { key: 'x' }, 'X']], /the key "x" twice/);
  // As many whole marks as fit beside the count; one at least, however narrow.
  assert.deepEqual(fitCount([50, 50, 50], 200, 20, 0), { shown: 3, rest: 0 });
  assert.deepEqual(fitCount([50, 50, 50, 50], 150, 20, 0), { shown: 2, rest: 2 });
  assert.deepEqual(fitCount([50, 50, 50], 120, 20, 10), { shown: 1, rest: 2 });
  assert.deepEqual(fitCount([500, 50], 100, 20, 0), { shown: 1, rest: 1 });
});

test('any mark may light up to 500 items', () => {
  const ids = Array.from({ length: 500 }, (_, i) => `e_${String(i).padStart(8, 'a')}`.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]));
  assert.equal(checkMarks(['text', { lights: ids }, 'x']).at.lights.length, 500);
  refused(['text', { lights: [...ids, 'e_zzzzzzzz'] }, 'x'], /at most 500 items/);
  refused(['text', { lights: ['nope'] }, 'x'], /not an item's id/);
});

test('a web mark frames an address on the web, sandboxed, and nothing else', () => {
  const w = checkMarks(['web', { key: 'site', url: 'https://example.com/a?b=1', reload: '3' }]);
  assert.equal(w.at.url, 'https://example.com/a?b=1');
  refused(['web', {}], /a web with no url/);
  refused(['web', { url: 'javascript:alert(1)' }], /not an address on the web/);
  refused(['web', { url: 'https://x.test' }, ['text', 'x']], /a web holding something/);
  assert.match(SANDBOX, /allow-scripts/);
  assert.doesNotMatch(SANDBOX, /allow-top-navigation/);
  // A pane's address of w?url= frames that page; any other is a canvas's.
  assert.equal(webOf(`w?url=${encodeURIComponent('https://a.test/x')}`), 'https://a.test/x');
  assert.equal(webOf('w?url=javascript%3Aalert(1)'), null);
  assert.equal(webOf('v?find=task'), null);
});

test('panes hold panes, each a canvas at an address with its strip', () => {
  const p = checkMarks(['panes', { key: 'room', dir: 'row' },
    ['pane', { key: 'p1', at: 'v?find=task', share: 0.6, drag: 'pane', ring: true }, ['text', 'Tasks'], ['button', { key: 'p1-x', aux: true }, '×']],
    ['pane', { key: 'p2', at: 'w?url=https%3A%2F%2Fa.test', share: 0.4 }],
  ]);
  assert.ok(isChecked(p));
  assert.equal(p.kids[0].at.share, 0.6);
  assert.equal(p.kids[1].at.at, 'w?url=https%3A%2F%2Fa.test');
  refused(['panes', {}], /a panes with no key/);
  refused(['pane', { key: 'a' }], /a pane with no at/);
  refused(['pane', { key: 'a', at: 'v?x" onload="y' }], /not an address of this page/);
  refused(['pane', { key: 'a', at: 'v', share: 0 }], /not a share above 0/);
  refused(['panes', { key: 'r' }, ['box']], /a box in a panes: it holds panes only/);
  refused(['box', {}, ['pane', { key: 'a', at: 'v' }]], /a pane in a box: panes hold panes/);
  refused(['panes', { key: 'r', dir: 'diagonal' }], /dir: "diagonal"/);
});

test('a tab is a box or a button: selected, ringing, in a hue, dragged, closed with the middle button', () => {
  const t = checkMarks(['box', { key: 'tabs', dock: true, flow: 'row' },
    ['button', { key: 't1', look: 'tab', selected: true, ring: true, hue: 'Sark', drag: 'tab', aux: true }, 'Sark'],
    ['box', { key: 't2', selected: false, drag: 'tab' }, ['text', 'Other']],
  ]);
  assert.equal(t.kids[0].at.look, 'tab');
  assert.equal(t.kids[0].at.hue, 'Sark');
  refused(['box', { drag: 'tab' }], /dragged or closed with no key/);
  refused(['box', { aux: true }], /dragged or closed with no key/);
  refused(['text', { drag: 'x' }, 'x'], /the attribute "drag" on a text/);
});

test('a drag lands on a side of a pane, its middle, the tabs or out', () => {
  assert.deepEqual(DROP_ZONES, ['left', 'right', 'above', 'below', 'center', 'tabs', 'out']);
  const box = { left: 0, top: 0, width: 300, height: 300 };
  assert.equal(zoneOf(box, 150, 150), 'center');
  assert.equal(zoneOf(box, 10, 150), 'left');
  assert.equal(zoneOf(box, 290, 150), 'right');
  assert.equal(zoneOf(box, 150, 10), 'above');
  assert.equal(zoneOf(box, 150, 290), 'below');
  assert.deepEqual(zoneBox(box, 'right'), { left: 150, top: 0, width: 150, height: 300 });
  assert.deepEqual(zoneBox(box, 'center'), box);
});
