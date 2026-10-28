// A style's colours worked out from a few (src/colours.ts), and each of the themes pack's checked for contrast: run
// without a database, each theme's preset in over the house style, ratios out.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contrast, finishTheme, mergeTheme, mix, search } from '../src/colours.ts';

const pack = (id: string) => JSON.parse(readFileSync(`packs/${id}/pack.json`, 'utf8'));
const styleOf = (id: string, style: string) => pack(id).styles.find((s: { id: string }) => s.id === style).props;
const house = styleOf('core', 'core.house').theme;
const added = [styleOf('work', 'work.reader_colours').theme, styleOf('software', 'software.public_colours').theme];
const themes = pack('themes').styles as { id: string; title: string; over: string; props: { theme: unknown } }[];

/** The colours a page is painted in with this theme chosen: the house's, the packs' own, the theme's, merged as the resolver merges them. */
const painted = (theme?: unknown) => finishTheme([house, ...added, ...(theme ? [theme] : [])].reduce((a, b) => mergeTheme(a, b), {}));

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

test('the colours packs add are worked out from the page\'s own, in every theme', () => {
  for (const theme of [undefined, ...themes.map((t) => t.props.theme)]) {
    const t = painted(theme);
    for (const s of ['light', 'dark'] as const) {
      assert.equal(t[s].reader_ink, t[s].text);
      assert.equal(t[s].reader_link, t[s].accent);
      assert.equal(t[s].public_bg, t[s].bg);
      assert.equal(t[s].public_ok, t[s].ok);
    }
    assert.equal(t.light.reader_page, t.light.panel);
    assert.equal(t.dark.reader_page, t.dark.bg);
  }
});

test('each theme is chosen, and holds its contrast: text, muted, accent and status on both grounds', () => {
  assert.ok(themes.length > 0 && themes.every((t) => t.over === 'chosen'), 'none is used until the owner keeps a version of it');
  const least = { text: { light: 12, dark: 12 }, muted: { light: 4.5, dark: 4.5 }, accent: { light: 4.5, dark: 4.5 }, ok: { light: 4.5, dark: 4.5 }, warn: { light: 4.5, dark: 4.5 }, bad: { light: 4.5, dark: 4.5 } };
  for (const theme of themes) {
    const t = painted(theme.props.theme);
    for (const s of ['light', 'dark'] as const)
      for (const [name, at] of Object.entries(least))
        for (const ground of ['bg', 'panel']) {
          const ratio = contrast(t[s][name], t[s][ground]);
          assert.ok(ratio >= at[s], `${theme.title} ${s}: ${name} ${t[s][name]} on ${ground} ${t[s][ground]} is ${ratio.toFixed(2)}:1, under ${at[s]}:1`);
        }
    assert.ok(contrast(t.dark.accent, t.dark.bg) >= 7, `${theme.title}'s dark accent holds 7:1 on its ground`);
    // A theme of one sea makes its accent from it, and the brand's colours for it already hold: kept as they are. One
    // with a mark of its own (a place's moss, lava or lupin) makes it from that, as much darker or lighter as it must.
    const { light, dark } = (theme.props.theme as { light: { sea: string; mark?: string }; dark: { sea: string } });
    if (!light.mark) assert.deepEqual([t.light.accent, t.dark.accent], [light.sea, dark.sea], `${theme.title}'s accent is its sea`);
  }
});

test('each theme carries its own emblem, a PNG drawn in its place\'s colours, and the house style one too', () => {
  const png = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
  const emblems = themes.map((t) => (t.props as { emblem?: string }).emblem ?? '');
  for (const [i, e] of emblems.entries()) assert.match(e, png, `${themes[i].title} has an emblem`);
  assert.match(styleOf('core', 'core.house').emblem, png, 'the house style has one');
  // Open water and Bay are of no one place: they keep the emblem's own. Every place's is its own.
  const places = emblems.filter((_, i) => !['themes.open_water', 'themes.bay'].includes(themes[i].id));
  assert.equal(new Set(places).size, places.length, 'one for each place');
});
