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

test('each theme preset changes boards, terrain and wires together, in both schemes', () => {
  const base = finished();
  for (const id of THEMES.slice(1) as string[]) {
    const theme = finished(id);
    for (const scheme of SCHEMES) {
      assert.notEqual(theme[scheme].land_1, base[scheme].land_1, `${id} terrain`);
      assert.notEqual(theme[scheme].board_active, base[scheme].board_active, `${id} boards follow the active role`);
    }
    assert.equal(style(id).over, 'palette', 'a palette lies over any chosen look, and is chosen alone among palettes');
  }
  assert.notEqual(finished('canvas.theme_field').light.wire_ink, base.light.wire_ink, 'wires follow the theme');
});
