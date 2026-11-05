// The flow draws each island as a region round what lives on it, where a picture holds more than one (task
// e_auw7hb3v): named in the key and over its top left step, in the style's island_hues, laid out a shore apart so no
// island's land reaches a step of another. A picture of one island draws no border.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'flow-islands-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.flow').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
const measure = (t: string, px: number) => t.length * px * 0.55;
const item = (id: string, title: string, island?: string, kind = 'work') => ({ id, type: 'task', is: [kind], title, open: true, status: 'todo', phase: 'not_started', ...(island && { island }) });
const answer = {
  islands: [{ id: 'e_grantsis', title: 'Grants' }, { id: 'e_lablabis', title: 'Lab' }],
  items: [
    item('e_writezzz', 'Write the bid', 'e_grantsis'), item('e_budgetzz', 'Set the budget', 'e_grantsis'), item('e_sendzzzz', 'Send it', 'e_grantsis'),
    item('e_runzzzzz', 'Run the trial', 'e_lablabis'), item('e_costzzzz', 'Cost per sample', 'e_lablabis', 'record'),
    item('e_alexzzzz', 'Alex', undefined, 'actor'),
  ],
  links: [
    { type: 'depends_on', from: 'e_sendzzzz', to: 'e_writezzz' },
    { type: 'depends_on', from: 'e_writezzz', to: 'e_budgetzz' },
    { type: 'depends_on', from: 'e_costzzzz', to: 'e_runzzzzz' },
    // The finding read across: the one link between the two islands.
    { type: 'reads', is: ['uses'], from: 'e_budgetzz', to: 'e_costzzzz' },
    { type: 'waits_on', from: 'e_sendzzzz', to: 'e_alexzzzz' },
  ],
};
const draw = (a: any, style: any = house) => picture({ answer: a, style, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} }).scene;

/** Every mark under `mark` that `test` holds of, depth first. */
const marks = (mark: any, hold: (m: any) => boolean): any[] => {
  if (!Array.isArray(mark)) return [];
  if (typeof mark[0] !== 'string') return mark.flatMap((k) => marks(k, hold));
  return [...(hold(mark) ? [mark] : []), ...mark.slice(2).flatMap((k: any) => marks(k, hold))];
};
const keyed = (svg: any, key: string) => marks(svg, (m) => m[1]?.key === key)[0];
const rectsIn = (mark: any) => marks(mark, (m) => m[0] === 'rect').map((m) => Object.fromEntries(['x', 'y', 'width', 'height'].map((k) => [k, Number(m[1][k])])));
const meet = (a: any, b: any) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('a picture of two islands draws each as a region, named in the key and on it', () => {
  const scene = draw(answer);
  const [grants, lab] = ['e_grantsis', 'e_lablabis'].map((id) => keyed(scene.svg, `i:${id}`));
  assert.ok(grants && lab, 'each island is a mark of its own');
  const [g0, g1] = house.island_hues.map((h: string) => `lf-i-${h.slice(1).toLowerCase()}`);
  assert.ok(grants[1].class.includes(g0) && lab[1].class.includes(g1), 'each in its colour, in the order the answer names them');
  assert.ok(scene.css.includes(`.${g0} { --lf-island: ${house.island_hues[0]}; }`), 'the colour is a rule, not a style on the mark');
  const labels = scene.key.map((e: any) => e.label);
  assert.ok(labels.includes('Grants') && labels.includes('Lab'), `the key names each island: ${labels.join(', ')}`);
  assert.ok(JSON.stringify(grants).includes('"Grants"'), 'the region carries its name');
  assert.ok(marks(grants, (m) => m[0] === 'a' && m[1].href === '#/e/e_grantsis').length === 1, 'the name opens the island');
  // The regions are drawn first, under every wire and step.
  assert.equal(scene.svg[2][1].key, 'i:e_grantsis');
});

test('no island\'s land reaches a step that lives on another, and the actor is on none', () => {
  const scene = draw(answer);
  const stepBox = (id: string) => rectsIn(keyed(scene.svg, `s:${id}`))[0] ?? (() => { throw new Error(`no box for ${id}`); })();
  const land = (id: string) => rectsIn(marks(keyed(scene.svg, `i:${id}`), (m) => m[1]?.class === 'lf-land')[0]);
  for (const r of land('e_grantsis')) for (const id of ['e_runzzzzz']) assert.ok(!meet(r, stepBox(id)), `Grants' land reaches ${id}`);
  for (const r of land('e_lablabis')) for (const id of ['e_writezzz', 'e_budgetzz', 'e_sendzzzz']) assert.ok(!meet(r, stepBox(id)), `Lab's land reaches ${id}`);
  for (const id of ['e_writezzz', 'e_budgetzz', 'e_sendzzzz']) assert.ok(land('e_grantsis').some((r) => meet(r, stepBox(id))), `${id} is on Grants' land`);
});

test('a picture of one island, or of none, draws no border', () => {
  const one = { ...answer, items: answer.items.filter((i) => i.island !== 'e_lablabis') };
  for (const a of [one, { ...answer, islands: undefined, items: answer.items.map(({ island, ...i }) => i) }]) {
    const scene = draw(a);
    assert.equal(marks(scene.svg, (m) => String(m[1]?.class ?? '').includes('lf-island')).length, 0);
    assert.ok(!scene.css.includes('lf-shore'), 'nor its rules');
  }
});
