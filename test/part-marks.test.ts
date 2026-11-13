// What a part may answer with (packs/walls/page/part-check.js), without a page: each kind checked by its shape, every refusal named
// with where it was, the caps held, and only what the check made marked as checked for the renderer.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks, isChecked, partLimits, MARKS, TONES } from '../packs/walls/page/part-check.js';

const refused = (mark: unknown, said: RegExp) => assert.throws(() => checkMarks(mark), (e: Error) => said.test(e.message) && /cannot be drawn/.test(e.message));

test('a screen of every kind is checked into nodes the renderer draws', () => {
  const root = checkMarks([
    'box', { flow: 'column', gap: 5, pad: 8 },
    ['text', { look: 'title' }, 'Inbox ', 3],
    ['list', { look: 'rows' }, ['box', { key: 'r1', flow: 'row', item: 'e_abcdefgh' }, ['text', 'First'], ['button', { key: 'open-1', look: 'quiet' }, 'Open']]],
    ['input', { key: 'q', hint: 'Find', value: 'a' }],
    ['paint', { key: 'map', width: 400, height: 300, pixels: true }, ['path', { d: 'M0 0L10 10Z', tone: 'accent', weight: 2 }], ['text', { x: 4, y: 12, anchor: 'start' }, 'here']],
  ]);
  assert.ok(isChecked(root));
  assert.equal(root.mark, 'box');
  assert.deepEqual(root.at, { flow: 'column', gap: 5, pad: 8 });
  assert.equal(root.kids[0].words, 'Inbox 3');
  const row = root.kids[1].kids[0];
  assert.equal(row.key, 'r1');
  assert.equal(row.item, 'e_abcdefgh');
  assert.ok(isChecked(row.kids[1]));
  assert.equal(root.kids[3].kids[0].at.d, 'M0 0L10 10Z');
  assert.equal(root.kids[3].kids[1].words, 'here');
  // Something shaped like a node is not one.
  assert.equal(isChecked(JSON.parse(JSON.stringify(root))), false);
});

test('attributes may be left out', () => {
  assert.deepEqual(checkMarks(['text', 'Hello']).words, 'Hello');
  assert.deepEqual(checkMarks(['box']).kids, []);
});

test('what is not in the vocabulary is refused, with where it was', () => {
  refused(['div', {}], /the mark "div"/);
  refused(['box', {}, ['script', {}]], /the mark "script" \(at box 0\)/);
  refused(['box', { onclick: 'x' }], /the attribute "onclick" on a box/);
  refused(['box', { style: 'color: red' }], /the attribute "style"/);
  refused(['text', { tone: 'red' }, 'x'], /tone: "red", not one of accent/);
  refused(['box', { gap: 2.5 }], /gap: 2.5, not a whole step/);
  refused(['box', { gap: 15 }], /not a whole step from 0 to 14/);
  refused(['box', { item: 'https://x.test' }], /not an item's id/);
  refused('<b>hi</b>', /not \[kind, attributes/);
  refused(['box', 'loose words'], /words in a box: put them in a text/);
  refused(['text', {}, ['box']], /a text holding a mark/);
  refused(['input', { key: 'a' }, 'x'], /an input holding something/);
});

test('what the person acts on has a key, and no key is used twice', () => {
  refused(['button', {}, 'Go'], /a button with no key/);
  refused(['input', {}], /an input with no key/);
  refused(['box', {}, ['button', { key: 'go' }, 'Go'], ['input', { key: 'go' }]], /the key "go" twice/);
  refused(['button', { key: 'a b' }, 'Go'], /key: a key of letters/);
});

test('paths and placed text lie on a paint surface, and only there', () => {
  refused(['path', { d: 'M0 0' }], /a path off a paint surface/);
  refused(['box', {}, ['path', { d: 'M0 0' }]], /a path off a paint surface/);
  refused(['paint', { width: 10, height: 10 }, ['box']], /a box on a paint surface/);
  refused(['paint', { width: 10, height: 10 }, ['paint', { width: 1, height: 1 }]], /paint surface on a paint surface/);
  refused(['paint', { width: 10, height: 10 }, ['text', 'loose']], /text on a paint surface with no x and y/);
  refused(['text', { x: 1, y: 2 }, 'placed'], /x, y or anchor on text off a paint surface/);
  refused(['paint', { width: 10 }], /with no width and height/);
  refused(['paint', { width: 0, height: 10 }], /not a size above nothing/);
  refused(['paint', { width: 10, height: 10 }, ['path', {}]], /a path with no d/);
  refused(['paint', { width: 10, height: 10 }, ['path', { d: 'M0 0 url(x)' }]], /not a path command/);
  refused(['paint', { width: 10, height: 10, start: [1] }], /not \[x, y\]/);
});

test('a note holds words in the dialect, a menu holds buttons, and any mark on the page may carry a tip', () => {
  const root = checkMarks([
    'box', { tip: 'The whole of it' },
    ['note', { key: 'n', tick: true, tip: 'How it was found' }, '## Why\n- [ ] check it'],
    ['menu', { key: 'more', label: '⋯', look: 'quiet' }, ['button', { key: 'stand', tip: 'Mark it published' }, 'Stand by']],
    ['input', { key: 'q', tip: 'Find' }],
    ['paint', { width: 10, height: 10, tip: 'A map' }],
  ]);
  assert.equal(root.at.tip, 'The whole of it');
  assert.equal(root.kids[0].words, '## Why\n- [ ] check it');
  assert.equal(root.kids[0].at.tick, true);
  assert.equal(root.kids[1].kids[0].mark, 'button');
  refused(['menu', { label: 'More' }, ['text', 'loose']], /a text in a menu: it holds buttons only/);
  refused(['menu', {}, ['button', { key: 'a' }, 'A']], /a menu with no label/);
  refused(['note', {}, ['text', 'x']], /a note holding a mark/);
  refused(['note', { tick: true }, '- [ ] a'], /a note that ticks with no key/);
  refused(['paint', { width: 10, height: 10 }, ['path', { d: 'M0 0', tip: 'x' }]], /the attribute "tip" on a path/);
  refused(['paint', { width: 10, height: 10 }, ['text', { x: 1, y: 1, tip: 'x' }, 'a']], /a tip on a text on a paint surface/);
  refused(['text', { tip: 'x'.repeat(partLimits.label + 1) }, 'a'], /tip: more than 200 characters/);
  refused(['note', {}, 'x'.repeat(partLimits.words + 1)], /more than 20000 characters/);
});

test('a part that says too much is refused whole', () => {
  const many = ['list', {}, ...Array.from({ length: partLimits.marks }, () => ['text', 'x'])];
  refused(many, /more than 5000 marks/);
  let deep: unknown[] = ['text', 'bottom'];
  for (let i = 0; i < partLimits.depth + 1; i++) deep = ['box', {}, deep];
  refused(deep, /deeper than/);
  refused(['text', 'x'.repeat(partLimits.words + 1)], /more than 20000 characters/);
  refused(['input', { key: 'a', hint: 'x'.repeat(partLimits.label + 1) }], /more than 200 characters/);
});

test('every look a mark may name has its rule in the stylesheet, reading the style', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'packs', 'walls', 'page', 'part-marks.css'), 'utf8');
  for (const t of TONES) assert.match(css, new RegExp(`\\.pm-tone-${t} \\{ color: var\\(--`), t);
  for (const [kind, shape] of Object.entries(MARKS) as [string, any][]) {
    assert.match(css, new RegExp(`\\.pm-${kind}\\b`), kind);
    const look = shape.attrs.look;
    if (!look) continue;
    // The looks a kind takes are the words its check accepts; every one but the plain default has a rule.
    const words = ['plain', 'band', 'sunk', 'body', 'title', 'muted', 'mark', 'code', 'rows', 'main', 'quiet', 'line', 'fill', 'dash'].filter((w) => {
      try {
        return look(w, () => {
          throw 0;
        }) === w;
      } catch {
        return false;
      }
    });
    for (const w of words.filter((w) => !['plain', 'body', 'line'].includes(w))) assert.match(css, new RegExp(`\\.pm-${kind}-${w}\\b`), `${kind} ${w}`);
  }
});

test('an input may be a pick, a day, a time, yes or no, a title; text may open an address on the web', () => {
  const pick = checkMarks(['input', { key: 'status', kind: 'pick', values: ['todo', 'done'], names: ['To do', 'Done'], value: 'todo' }]);
  assert.deepEqual(pick.at.values, ['todo', 'done']);
  assert.equal(checkMarks(['input', { key: 'd', kind: 'date', value: '2026-11-13' }]).at.kind, 'date');
  assert.equal(checkMarks(['input', { key: 't', look: 'title', focus: true, value: 'A name' }]).at.look, 'title');
  assert.equal(checkMarks(['input', { key: 'n', lines: 4, fits: true }]).at.fits, true);
  assert.equal(checkMarks(['text', { href: 'https://example.test/a' }, 'there']).at.href, 'https://example.test/a');
  refused(['input', { key: 's', kind: 'pick' }], /a pick with no values/);
  refused(['input', { key: 's', values: ['a'] }], /values on an input that is not a pick/);
  refused(['input', { key: 's', kind: 'pick', values: ['a', 'b'], names: ['A'] }], /names that are not one for each value/);
  refused(['input', { key: 's', kind: 'check', lines: 3 }], /lines on a check/);
  refused(['input', { key: 's', kind: 'colour' }], /kind: "colour", not one of/);
  refused(['text', { href: 'javascript:alert(1)' }, 'x'], /not an address on the web/);
  refused(['text', { href: 'https://x.test/"onmouseover' }, 'x'], /not an address on the web/);
  refused(['paint', { width: 9, height: 9 }, ['text', { x: 1, y: 1, href: 'https://x.test' }, 'x']], /an href on text on a paint surface/);
});

test('an item is found by name or picked on the canvas, the host doing the finding', () => {
  assert.deepEqual(checkMarks(['input', { key: 'owner', kind: 'item', types: ['person'], hint: 'Find a person' }]).at.types, ['person']);
  assert.equal(checkMarks(['input', { key: 'to', kind: 'item', link: true }]).at.link, true);
  assert.equal(checkMarks(['button', { key: 'link', pick: 'link' }, 'Link']).at.pick, 'link');
  refused(['input', { key: 'x', types: ['task'] }], /types or link on an input that finds no item/);
  refused(['input', { key: 'x', kind: 'item', lines: 2 }], /lines on an item/);
  refused(['button', { key: 'x', pick: 'anything' }, 'Go'], /pick: "anything", not one of item, link/);
});
