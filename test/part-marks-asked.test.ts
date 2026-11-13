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

test('a swatch names a style preset and the host paints it; a button may try one, or copy words', () => {
  const s = checkMarks(['box', { flow: 'row' },
    ['swatch', { key: 'sw-ocean', preset: 'styles.ocean', tip: 'Ocean', label: 'Ocean', on: 'trying' }],
    ['button', { key: 'try-ocean', try: 'styles.ocean' }, 'Ocean'],
    ['button', { key: 'try-house', try: null }, 'House'],
    ['button', { key: 'copy', copy: 'https://x.test/mcp' }, 'Copy'],
  ]);
  assert.equal(s.kids[0].at.preset, 'styles.ocean');
  assert.equal(s.kids[2].at.try, '');
  assert.equal(s.kids[0].at.on, 'trying');
  refused(['swatch', { preset: 'a', on: 'chosen' }], /on: "chosen", not one of kept, trying/);
  refused(['button', { key: 'c', copy: 'x'.repeat(2001) }, 'Copy'], /copy: more than 2000 characters/);
  refused(['swatch', {}], /a swatch with no preset/);
  refused(['swatch', { preset: '#ff0000' }], /preset: a key of letters/);
  refused(['swatch', { preset: 'a', color: 'red' }], /the attribute "color" on a swatch/);
  refused(['button', { key: 'b', try: 'a b' }, 'x'], /try: a key of letters/);
});

test('text may stand for a session, in its hue, on the page only', () => {
  assert.equal(checkMarks(['text', { hue: 'Sark' }, 'Session Sark']).at.hue, 'Sark');
  refused(['paint', { width: 10, height: 10 }, ['text', { x: 1, y: 1, hue: 'Sark' }, 'x']], /a hue on text on a paint surface/);
});

test('panes stand one over another on a tall page, and give an open sheet its room', async () => {
  // @ts-ignore
  const { dirOn, sheetRoom } = await import('../packs/walls/page/part-pane.js');
  assert.equal(dirOn('row', 1200, 800), 'row');
  assert.equal(dirOn('row', 600, 900), 'column');
  assert.equal(dirOn('column', 1200, 800), 'column');
  assert.equal(sheetRoom(true, 400, 1600), 0.25);
  assert.equal(sheetRoom(true, 1500, 1600), 0, 'a sheet over most of the page takes no room beside the panes');
  assert.equal(sheetRoom(false, 400, 1600), 0);
});

test('a trace names an item and its line, and is drawn nowhere itself', () => {
  const t = checkMarks(['list', {}, ['trace', { key: 'tr1', item: 'e_abcdefgh', tip: 'Session Sark, set status done: shipped', hue: 'Sark' }]]);
  assert.equal(t.kids[0].at.item, 'e_abcdefgh');
  refused(['trace', { tip: 'x' }], /a trace with no item/);
  refused(['trace', { item: 'e_abcdefgh' }, ['text', 'x']], /a trace holding something/);
  refused(['trace', { item: 'e_abcdefgh', tip: 'x'.repeat(501) }], /tip: more than 500 characters/);
});

test('a replay names its step and the entries it plays, and the host plays them through the store', async () => {
  const r = checkMarks(['replay', { key: 'rp', at: 1, steps: [{ pos: 7, ids: ['e_abcdefgh', 'r_abcdefgh'] }, { pos: 9, ids: ['e_abcdefgh'] }] }]);
  assert.equal(r.at.steps[1].pos, 9);
  refused(['replay', { at: 0 }], /a replay with no steps/);
  refused(['replay', { at: 0, steps: [{ pos: -1, ids: [] }] }], /a step that is not \{ pos, ids \}/);
  refused(['replay', { at: 0, steps: [{ pos: 1, ids: ['x'] }] }], /not an item's or a link's id/);
  // @ts-ignore
  const { stepsFrom } = await import('../packs/surface/page/replay.js');
  const entries = [{ pos: 7, at: 't', facts: [['+', 'e_abcdefgh', 'title', 'A'], ['+', 'e_zzzzzzzz', 'title', 'B']] }];
  assert.deepEqual(stepsFrom(entries, [{ pos: 7, ids: ['e_abcdefgh'] }, { pos: 8, ids: [] }]).map((s: any) => s.facts), [[['+', 'e_abcdefgh', 'title', 'A']]]);
});

test('the host rewinds the store, plays each step once, and ends where the map is', async () => {
  // @ts-ignore
  const { replayIn } = await import('../packs/surface/page/replay.js');
  const applied: number[] = [], projected: number[] = [];
  const store: any = { items: new Map([['e_new00000', { title: 'made since' }], ['e_abcdefgh', { title: 'now' }]]), links: new Map(), at: new Map(), kinds: {}, apply: (x: any) => applied.push(x.pos) };
  const view = { store, ids: ['e_new00000', 'e_abcdefgh'], links: new Map(), tell: () => {} };
  const entries = [{ pos: 7, at: 'a', facts: [['+', 'e_abcdefgh', 'title', 'B']] }, { pos: 9, at: 'b', facts: [['+', 'e_new00000', 'type', 'task']] }];
  store.missed = { view, then: { items: new Map([['e_abcdefgh', { title: 'then' }]]), links: new Map() }, entries, from: 5, to: 9 };
  const steps = [{ pos: 7, ids: ['e_abcdefgh'] }, { pos: 9, ids: ['e_new00000'] }];
  replayIn(store, { at: 0, steps }, () => {});
  assert.equal(store.playing, true);
  assert.equal(store.items.get('e_abcdefgh').title, 'then');
  assert.equal(store.items.has('e_new00000'), false, 'what was made since leaves while it plays');
  replayIn(store, { at: 1, steps }, () => {});
  replayIn(store, { at: 1, steps }, () => {});
  assert.deepEqual(applied, [7], 'a step is played once');
  replayIn(store, null, (_s: any, _k: any, at: string) => projected.push(at === 'b' ? 9 : 0));
  assert.deepEqual(projected, [9], 'what was not played is projected at once');
  assert.equal(store.playing, false);
  assert.equal(store.at.get('e_abcdefgh'), 9);
});

test('a ghost is data: an item, a link or a mark on one, held for the owner', () => {
  const g = checkMarks(['list', {},
    ['ghost', { of: 'item', id: 'p_ab12:ref', type: 'task', title: 'Draft', proposal: 'p_ab12', op: 'create', by: 'Session Sark' }],
    ['ghost', { of: 'link', id: 'p_ab12:#2', type: 'depends_on', from: 'p_ab12:ref', to: 'e_abcdefgh', proposal: 'p_ab12', op: 'link' }],
    ['ghost', { of: 'mark', on: 'e_abcdefgh', proposal: 'p_ab12', op: 'archive' }],
  ]);
  assert.equal(g.kids[1].at.from, 'p_ab12:ref');
  refused(['ghost', { of: 'item', id: 'p_ab12:ref', type: 'task', proposal: 'p_ab12', op: 'create' }], /a ghost of an item with no title/);
  refused(['ghost', { of: 'mark', on: 'e_abcdefgh', proposal: 'p_ab12', op: 'create' }], /a ghost of a mark that is create/);
  refused(['ghost', { of: 'item', id: 'x', type: 'task', title: 'a', proposal: 'p_ab12', op: 'create' }], /not a ghost's id/);
});

test('shapes on a paint surface may be filled as a diagram is, say themselves and lead out; a surface may keep its zoom', () => {
  const p = checkMarks(['paint', { width: 100, height: 50, controls: true },
    ['path', { d: 'M0 0H10V10Z', look: 'box', tip: 'The server', href: 'https://github.com/x/y/blob/main/a.ts' }],
    ['text', { x: 2, y: 8, tip: 'A label', href: 'https://x.test' }, 'Server'],
  ]);
  assert.equal(p.at.controls, true);
  assert.equal(p.kids[0].at.look, 'box');
  assert.equal(p.kids[1].at.href, 'https://x.test');
  refused(['paint', { width: 9, height: 9 }, ['path', { d: 'M0 0', look: 'cloud' }]], /look: "cloud"/);
});

test("a field may keep keys for its part: at most eight, each a key's name", () => {
  const f = checkMarks(['input', { key: 'q', kind: 'search', focus: true, keys: ['ArrowUp', 'ArrowDown', 'Escape', 'Backspace'] }]);
  assert.deepEqual(f.at.keys, ['ArrowUp', 'ArrowDown', 'Escape', 'Backspace']);
  refused(['input', { key: 'q', keys: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }], /at most 8 key names/);
  refused(['input', { key: 'q', keys: ['Ctrl+A'] }], /not a key name/);
});

test('a slot mark names a slot the part opens, and no other', () => {
  const s = checkMarks(['box', {}, ['slot', { name: 'sheet.bands' }], ['slot', { key: 'sec', name: 'sheet.sections' }]], { opens: ['sheet.bands', 'sheet.sections'] });
  assert.equal(s.kids[0].at.name, 'sheet.bands');
  assert.throws(() => checkMarks(['slot', { name: 'bar.find' }], { opens: ['sheet.bands'] }), /the slot "bar.find", which the part does not open/);
  refused(['slot', {}], /a slot with no name/);
  refused(['slot', { name: 'a' }, ['text', 'x']], /a slot holding something/);
});

test("a field keeps the person's words against an echo, but takes a value the part sends once it has caught up", async () => {
  // @ts-ignore
  const { setsField } = await import('../packs/walls/page/part-echo.js');
  // Typed '', then 'only ': the part echoes '' (behind), then 'only ' (caught up), then clears it with '' on purpose.
  const heard = ['', 'o', 'on', 'onl', 'only', 'only '];
  assert.equal(setsField(heard, '', 'only ', true), false, 'an echo of what was typed earlier is let be');
  assert.equal(setsField(heard, 'onl', 'only ', true), false);
  assert.deepEqual(heard, ['onl', 'only', 'only ']);
  assert.equal(setsField(heard, 'only ', 'only ', true), false);
  assert.deepEqual(heard, []);
  assert.equal(setsField(heard, '', 'only ', true), true, 'the part clearing the field is set');
  // The reported case: the answer to 'only ' clears it, while '' is still among what was sent.
  assert.equal(setsField(['', 'only '], '', 'only ', true), false, 'still ambiguous without an answer between');
  const h2 = ['', 'only '];
  setsField(h2, 'only ', 'only ', true);
  assert.equal(setsField(h2, '', 'only ', true), true);
  assert.equal(setsField(['x'], 'x', 'y', false), true, 'out of the field, the part has its way');
});
