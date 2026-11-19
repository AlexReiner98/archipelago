// The canvas's colours as the theme finishes them (round 6, the palette): the words on a board read at 4.5 to 1 or better,
// the terrain stands off the ground, and the theme presets change boards, terrain and wires together. The canvas pack is read
// as data; nothing of it is imported.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { contrast, finishTheme, mix } from './colours.ts';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'canvas', 'pack.json'), 'utf8'));
const style = (id: string) => pack.styles.find((s: any) => s.id === id);
const house = style('core.house').props, waymark = style('canvas.waymark').props;
const finished = (id?: string) => finishTheme({ derive: house.theme.derive, light: { ...house.theme.light, ...(id ? style(id).props.theme.light : {}) }, dark: { ...house.theme.dark, ...(id ? style(id).props.theme.dark : {}) } });
const SCHEMES = ['light', 'dark'] as const, THEMES = [undefined, 'canvas.theme_field', 'canvas.theme_ochre', 'canvas.theme_clear'];

test('the roles a drawing is given each name a theme colour that exists in both schemes', () => {
  const theme = finished();
  for (const [role, name] of Object.entries(house.roles)) for (const scheme of SCHEMES) assert.ok(theme[scheme][name as string], `${role} → ${name} in ${scheme}`);
  for (const scheme of SCHEMES) assert.notEqual(theme[scheme].you, theme[scheme].warn, `you has a colour of its own in ${scheme}`);
});

test('the words on a board, and on its who plate, read at 4.5 to 1 or better in every theme', () => {
  for (const id of THEMES) {
    const theme = finished(id);
    for (const f of Object.values(waymark.board_fills) as any[]) for (const scheme of SCHEMES) {
      const t = theme[scheme], ratio = contrast(t[f.fill], t[f.text]), plate = contrast(mix(t[f.fill], '#000000', 0.82), t[f.text]);
      assert.ok(ratio >= 4.5, `${id ?? 'default'} ${scheme} ${f.fill}: ${ratio.toFixed(2)}`);
      assert.ok(plate >= 4.5, `${id ?? 'default'} ${scheme} ${f.fill} plate: ${plate.toFixed(2)}`);
    }
  }
});

test('terrain tones stand off the ground, and boards stand off it more', () => {
  for (const id of THEMES) for (const scheme of SCHEMES) {
    const t = finished(id)[scheme];
    for (let k = 1; k <= 8; k++) assert.ok(contrast(t[`land_${k}`], t.bg) >= 1.05, `${id ?? 'default'} land_${k} in ${scheme}: ${contrast(t[`land_${k}`], t.bg).toFixed(2)}`);
    for (const board of ['board_todo', 'board_active', 'board_waiting', 'board_done']) assert.ok(contrast(t[board], t.bg) >= 1.1, `${id ?? 'default'} ${board} in ${scheme}`);
  }
});

const hueOf = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return { hue: 0, chroma: 0 };
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: h * 60, chroma: d / max };
};

test('colour means status, in every palette: blue in progress, red blocked, amber waiting, quiet green done, neutral to do', () => {
  for (const id of THEMES) for (const scheme of SCHEMES) {
    const t = finished(id)[scheme], at = (n: string) => hueOf(t[n]);
    const label = `${id ?? 'default'} ${scheme}`;
    assert.ok(at('board_active').hue >= 200 && at('board_active').hue <= 235 && at('board_active').chroma >= 0.4, `${label} in progress is a clear blue`);
    assert.ok((at('board_blocked').hue <= 8 || at('board_blocked').hue >= 352) && at('board_blocked').chroma >= 0.7, `${label} blocked is a saturated red`);
    assert.ok(at('board_waiting').hue >= 35 && at('board_waiting').hue <= 50 && at('board_waiting').chroma >= 0.8, `${label} waiting is a clear amber`);
    assert.ok(at('board_done').hue >= 80 && at('board_done').hue <= 160 && at('board_done').chroma < at('board_waiting').chroma, `${label} done is a quieter green`);
    assert.ok(at('board_todo').chroma <= 0.15, `${label} to do is neutral`);
    assert.ok(at('you').hue >= 255 && at('you').hue <= 290, `${label} you is violet`);
  }
});

test('the land is one quiet neutral step off the sea, in every palette', () => {
  for (const id of THEMES) for (const scheme of SCHEMES) {
    const t = finished(id)[scheme], ratio = contrast(t.land_neutral, t.bg);
    assert.ok(ratio >= 1.15 && ratio <= 1.3, `${id ?? 'default'} ${scheme}: ${ratio.toFixed(2)}`);
    assert.ok(hueOf(t.land_neutral).chroma <= 0.1, 'no hue to speak of');
  }
  assert.deepEqual(waymark.island_hues, ['land_neutral']);
});

test('the palettes differ in temperament, never in which hue means what', () => {
  const base = finished();
  for (const id of THEMES.slice(1) as string[]) {
    const theme = finished(id);
    assert.ok(SCHEMES.some((scheme) => ['board_active', 'board_done', 'you', 'wire_ink'].some((n) => theme[scheme][n] !== base[scheme][n])), `${id} differs from the default`);
    assert.equal(style(id).over, 'palette', 'a palette lies over any chosen look, and is chosen alone among palettes');
  }
});
