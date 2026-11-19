// Each island is drawn about its own corner, in a group moved to where it stands (layouts/flow/isle-local.js): an
// island that only moves (another put beside it, at another corner) says the same marks under another move, which
// the page keeps as they are (packs/walls/page/marks-kept.js). Drawn as the page draws it, through `picture`.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { unmoved } from './marks-moved.ts';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'pelago-map-moved-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
const measure = (t: string, px: number) => t.length * px * 0.55;
const item = (id: string, title: string, island: string) => ({ id, type: 'task', is: ['work'], title, open: true, status: 'todo', phase: 'not_started', island });
const answer = {
  islands: [{ id: 'e_grantsis', title: 'Grants' }, { id: 'e_lablabis', title: 'Lab' }],
  items: [item('e_writezzz', 'Write the bid', 'e_grantsis'), item('e_budgetzz', 'Set the budget', 'e_grantsis'), item('e_runzzzzz', 'Run the trial', 'e_lablabis')],
  links: [{ type: 'depends_on', from: 'e_writezzz', to: 'e_budgetzz' }],
};
const draw = (placed: any) => picture({ answer, style: { ...house, placed }, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} }).scene.svg;
const top = (svg: any, key: string) => svg.slice(2).find((m: any) => m?.[1]?.key === key);
const unkeyedMove = (mark: any) => JSON.stringify([mark[0], { ...mark[1], transform: null }, ...mark.slice(2)]);

test('an island that only moved says its marks alike, under another move', () => {
  const [here, there] = [draw({ e_grantsis: [0, 0], e_lablabis: [4, 0] }), draw({ e_grantsis: [0, 0], e_lablabis: [7, 2] })];
  for (const key of ['i:e_lablabis', 'isle:e_lablabis']) {
    const [a, b] = [top(here, key), top(there, key)];
    assert.ok(a && b, `${key} is a group of its own`);
    assert.match(String(a[1].transform), /^translate\(/, `${key} is moved to the island's corner`);
    assert.notEqual(a[1].transform, b[1].transform, `${key} moved`);
    assert.equal(unkeyedMove(a), unkeyedMove(b), `${key} says the same marks`);
  }
  for (const key of ['i:e_grantsis', 'isle:e_grantsis']) assert.deepEqual(top(here, key), top(there, key), `${key}, which stayed, is said alike`);
});

test('read through its move, an island stands where it stood before it was drawn about its corner', () => {
  const svg = unmoved(draw({ e_grantsis: [0, 0], e_lablabis: [4, 0] }));
  const find = (mark: any, key: string): any => (Array.isArray(mark) ? (mark[1]?.key === key ? mark : mark.slice(2).map((m: any) => find(m, key)).find(Boolean)) : null);
  const land = find(svg, 'i:e_lablabis'), step = find(svg, 's:e_runzzzzz');
  const rect = (m: any): any => (Array.isArray(m) ? (m[0] === 'rect' ? m[1] : m.slice(2).map(rect).find(Boolean)) : null);
  const [l, s] = [rect(land), rect(step)];
  assert.ok(Number(s.x) >= Number(l.x) && Number(s.x) + Number(s.width) <= Number(l.x) + Number(l.width), 'its step stands inside its land');
  assert.ok(Number(s.y) >= Number(l.y) && Number(s.y) + Number(s.height) <= Number(l.y) + Number(l.height), 'top to bottom too');
});
