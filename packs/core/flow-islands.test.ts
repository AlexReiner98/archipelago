// The flow draws a picture of more than one island as an archipelago (task e_auw7hb3v; the owner, 5 Nov 2026): each
// island a region round what lives on it, laid out alone so no two overlap, named, with its own legend inside it and
// none in the corner; a link between islands crosses the sea, with a gate on each shore naming what crosses. A picture
// of one island draws no border.

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

const landOf = (svg: any, id: string) => rectsIn(marks(keyed(svg, `i:${id}`), (m) => m[1]?.class === 'lf-land')[0]);
const stepBox = (svg: any, id: string) => rectsIn(keyed(svg, `s:${id}`))[0] ?? (() => { throw new Error(`no box for ${id}`); })();
const ISLES = ['e_grantsis', 'e_lablabis'];
const ON: Record<string, string[]> = { e_grantsis: ['e_writezzz', 'e_budgetzz', 'e_sendzzzz'], e_lablabis: ['e_runzzzzz'] };

test('a picture of two islands draws each as a region, named, in its colour', () => {
  const scene = draw(answer);
  const [grants, lab] = ISLES.map((id) => keyed(scene.svg, `i:${id}`));
  assert.ok(grants && lab, 'each island is a mark of its own');
  const [g0, g1] = house.island_hues.map((h: string) => `lf-i-${h.slice(1).toLowerCase()}`);
  assert.ok(grants[1].class.includes(g0) && lab[1].class.includes(g1), 'each in its colour, in the order the answer names them');
  assert.ok(scene.css.includes(`.${g0} { --lf-island: ${house.island_hues[0]}; }`), 'the colour is a rule, not a style on the mark');
  assert.ok(marks(grants, (m) => m[0] === 'a' && m[1].href === '#/e/e_grantsis').length === 1, 'the name opens the island');
  assert.equal(scene.svg[2][1].key, 'i:e_grantsis', 'the regions are drawn first, under every wire and step');
});

test('no two islands overlap, and each holds its own steps and no other’s', () => {
  const svg = draw(answer).svg;
  for (const r of landOf(svg, ISLES[0])) for (const q of landOf(svg, ISLES[1])) assert.ok(!meet(r, q), 'Grants’ land meets Lab’s');
  for (const id of ISLES) {
    for (const s of ON[id]) assert.ok(landOf(svg, id).some((r) => meet(r, stepBox(svg, s))), `${s} is on its island`);
    for (const s of ON[ISLES.find((k) => k !== id)!]) assert.ok(!landOf(svg, id).some((r) => meet(r, stepBox(svg, s))), `${s} is not on ${id}`);
  }
});

const legendOf = (scene: any, id: string): string[] => marks(keyed(scene.svg, `i:${id}`), (m) => m[1]?.class === 'lf-island-key').map((m) => m.at(-1).at(-1));
/** What every island shares (principle e_jxtawgq7): never in an island's legend. */
const SHARED = ['Not started', 'Under way', 'Finished', 'Ended', 'Trouble', 'Held up', 'Waits on you', 'Held for you', 'Crosses here', 'Reads'];

test('each island carries its own legend and the corner has none', () => {
  const scene = draw(answer);
  assert.deepEqual(scene.key, [], 'no key in the corner');
  assert.ok(legendOf(scene, 'e_grantsis').includes('Work') && legendOf(scene, 'e_grantsis').includes('Leads to'), legendOf(scene, 'e_grantsis').join(', '));
  assert.ok(legendOf(scene, 'e_lablabis').includes('Record'), 'Lab’s says what a record is');
  assert.ok(!legendOf(scene, 'e_grantsis').includes('Record'), 'Grants’ says only what it draws');
});

test('an island that says its pack names, of it, only what is in use on it', () => {
  const pack = {
    title: 'Core',
    types: [{ id: 'aim', title: 'Aim' }, { id: 'task', title: 'Task' }, { id: 'finding', title: 'Finding' }],
    links: [{ id: 'owned_by', title: 'owned by' }, { id: 'depends_on', title: 'depends on' }, { id: 'reads', title: 'reads' }],
  };
  const scene = draw({ ...answer, islands: answer.islands.map((i) => ({ ...i, pack })) });
  assert.deepEqual(legendOf(scene, 'e_grantsis'), ['Task', 'depends on'], 'its items are tasks, its own links depends on: no aim, no finding, no owned by, and the read across is told at its gate');
});

test('an island’s legend holds only its vocabulary: the shared marks are told in a tip on the mark', () => {
  const you = 'e_alexzzzz';
  const a = {
    ...answer, viewer: you,
    items: answer.items.map((i) => (i.id === 'e_runzzzzz' ? { ...i, phase: 'trouble' } : i.id === 'e_writezzz' ? { ...i, phase: 'under_way', pending: { proposal: 'e_heldheld', op: 'update', reason: 'A test' } } : i)),
    links: [...answer.links, { type: 'waits_on', from: 'e_budgetzz', to: you }],
  };
  const scene = draw(a);
  for (const id of ISLES) for (const word of SHARED) assert.ok(!legendOf(scene, id).includes(word), `${id}’s legend says “${word}”: ${legendOf(scene, id).join(', ')}`);
  const { on } = picture({ answer: a, style: house, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} });
  const tipOf = (key: string) => {
    const tip = on({ name: 'enter', key }).find((p: any) => p.tip)?.tip;
    assert.ok(tip, `${key} answers a hover with a tip`);
    return JSON.stringify(tip.mark);
  };
  // The phase dot, and trouble, each said on the dot.
  assert.ok(keyed(scene.svg, 'p:e_writezzz')?.[1].on.includes('enter'), 'the dot is a mark of its own to hover');
  assert.ok(tipOf('p:e_writezzz').includes('Under way'));
  assert.ok(tipOf('p:e_runzzzzz').includes('Trouble'));
  // Off the dot, the tip goes back to the step it is on.
  assert.equal(on({ name: 'leave', key: 'p:e_writezzz' }).find((p: any) => p.tip)?.tip?.key, 's:e_writezzz');
  // What waits on you is said in its step's tip.
  assert.ok(tipOf('s:e_budgetzz').includes('Waits on you'));
  assert.ok(tipOf('s:e_sendzzzz').includes('Waits on you') && !tipOf('s:e_costzzzz').includes('Waits on you'), 'and only there');
  // What is held for you, on its badge.
  const badge = marks(scene.svg, (m) => String(m[1]?.key ?? '').startsWith('held:e_heldheld'))[0];
  assert.ok(badge?.[1].on.includes('click') && badge[1].on.includes('enter'), 'the badge still decides on a click, and tells on a hover');
  assert.ok(tipOf(badge[1].key).includes('Held for you') && tipOf(badge[1].key).includes('A test'));
  // A finding crossing, on each gate and on its name in the sea.
  const gates = marks(scene.svg, (m) => /^(gate|cross):/.test(String(m[1]?.key ?? '')));
  assert.ok(gates.length >= 2);
  for (const g of gates) assert.ok(tipOf(g[1].key).includes('A finding read across'), g[1].key);
  assert.ok(tipOf('gate:0:0').includes('Grants') && tipOf('gate:0:1').includes('Lab'), 'each gate names the island it comes into or leaves');
});

test('a picture of one island keeps the shared marks in its key', () => {
  const one = { ...answer, items: answer.items.filter((i) => i.island !== 'e_lablabis').map((i) => (i.id === 'e_writezzz' ? { ...i, phase: 'under_way' } : i)) };
  const words = draw(one).key.map((r: any) => r.label);
  assert.ok(words.includes('Under way') && words.includes('Not started'), words.join(', '));
});

test('a finding read across crosses the sea, with a gate on each shore naming it', () => {
  const svg = draw({ ...answer, items: answer.items.map((i) => (i.id === 'e_costzzzz' ? { ...i, fields: { value: 42 } } : i)) }).svg;
  const gates = marks(svg, (m) => String(m[1]?.key ?? '').startsWith('gate:'));
  assert.equal(gates.length, 2, 'one where it leaves Lab, one where it enters Grants');
  for (const g of gates) assert.ok(JSON.stringify(g).includes('Cost per sample: 42'), 'each names what crosses, and its value');
  const wire = marks(svg, (m) => m[0] === 'path' && String(m[1]?.class ?? '').includes('lf-tie') && /^n:/.test(m[1].key ?? '')).find((m) => m[1].class.includes('headed') && gates.length);
  assert.ok(wire, 'the crossing is a tie');
});

test('a picture of one island, or of none, draws no border', () => {
  const one = { ...answer, items: answer.items.filter((i) => i.island !== 'e_lablabis') };
  for (const a of [one, { ...answer, islands: undefined, items: answer.items.map(({ island, ...i }) => i) }]) {
    const scene = draw(a);
    assert.equal(marks(scene.svg, (m) => String(m[1]?.class ?? '').includes('lf-island')).length, 0);
    assert.ok(!scene.css.includes('lf-shore'), 'nor its rules');
    assert.ok(scene.key.length > 0, 'and keeps its key');
  }
});
