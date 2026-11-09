// A style's colours worked out from a few (src/colours.ts): run without a database. The themes pack's own checks (each
// theme's contrast and emblem) went with it to the hosted service (9 Nov 2026).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contrast, finishTheme, mergeTheme, mix, search } from '../src/colours.ts';

test('a colour is worked out from others: a name, a mix, a search, one for each scheme', () => {
  const t = finishTheme({
    light: { paper: '#ffffff', ink: '#000000', sea: '#88aaff' },
    dark: { paper: '#000000', ink: '#ffffff', sea: '#88aaff' },
    derive: { bg: 'paper', half: { mix: ['ink', 'paper'], share: 0.5 }, accent: { search: 'sea', on: 'bg', ratio: { light: 4.5, dark: 7 } }, side: { light: 'ink', dark: '#123' } },
  });
  assert.equal(t.light.bg, '#ffffff');
  assert.equal(t.light.half, '#808080');
  assert.equal(t.dark.side, '#112233');
  assert.ok(contrast(t.light.accent, '#ffffff') >= 4.5 && contrast(t.light.accent, '#ffffff') < 4.7, 'darkened only as far as it must');
  assert.equal(t.dark.accent, '#88aaff', 'one that holds already is left as it is');
  assert.equal(search('#777777', ['#ffffff'], 21), '#000000', 'one that cannot hold goes as far as it can');
  assert.equal(mix('#ff0000', '#0000ff', 0.25), '#4000bf');
});

test('a name that cannot be worked out is left out, never painted wrong', () => {
  const t = finishTheme({ light: { a: 'b', b: 'a', c: 'nowhere', d: 'url(x)', e: { mix: ['a'], share: 1 }, f: '#abcdef' }, dark: {} });
  assert.deepEqual(t.light, { f: '#abcdef' });
});

test('a nearer layer\'s name is its own, whether it gives a colour or says how to work one out', () => {
  const merged = mergeTheme({ light: { accent: '#111111', bg: '#ffffff' }, dark: { accent: '#eeeeee' } }, { light: { sea: '#2255aa' }, derive: { accent: 'sea' }, dark: { sea: '#99bbff' } });
  assert.deepEqual(finishTheme(merged), { light: { accent: '#2255aa', bg: '#ffffff', sea: '#2255aa' }, dark: { accent: '#99bbff', sea: '#99bbff' } });
});

test('the house style carries its emblem, a PNG', () => {
  const house = JSON.parse(readFileSync('packs/core/pack.json', 'utf8')).styles.find((s: { id: string }) => s.id === 'core.house').props;
  assert.match(house.emblem, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
});
