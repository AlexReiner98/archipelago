// An island's declarations on the map (feature e_knepxwmn): its header shows a mark for its pack, then one for each
// pack that pack requires (decision e_cy9dfsna), each its name in quiet words (round 4 of e_unru8ftt), its tip the pack, its
// state and why, and where the session may write a toggle the page answers (packs/walls/page/marks-toggle.js). An item
// waiting on its pack is drawn faint at its cell, why in its tip (decision e_57bjxy2x).

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'pelago-map-decl-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const [{ picture }, { glyphOf }] = await Promise.all(['index.js', 'pack-marks.js'].map((n) => import(pathToFileURL(join(laid, n)).href)));
const measure = (t: string, px: number) => t.length * px * 0.55;

const item = (id: string, title: string, extra: any = {}) => ({ id, type: 'task', is: ['work'], title, open: true, status: 'todo', phase: 'not_started', island: 'e_buildisl', ...extra });
const answer = {
  islands: [{
    id: 'e_buildisl', title: 'Build the thing', focus: true,
    pack: { id: 'build', title: 'Build', glyph: '⚒', state: 'active', types: [], links: [], off_would_wait: 2, requires: [{ id: 'core', title: 'Core', state: 'active' }, { id: 'runs', title: 'Runs', state: 'off', why: 'Turned off on this island' }] },
  }],
  items: [item('e_buildisl', 'Build the thing'), item('e_onezzzzz', 'Make it'), item('e_twozzzzz', 'Ship it', { waiting: { pack: 'runs', why: 'Turned off on this island' } })],
  links: [{ type: 'depends_on', from: 'e_twozzzzz', to: 'e_onezzzzz' }],
};
const draw = (a: any, gestures?: any) => picture({ answer: a, style: house, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {}, ...(gestures && { gestures }) });

const marks = (mark: any, hold: (m: any) => boolean): any[] => {
  if (!Array.isArray(mark)) return [];
  if (typeof mark[0] !== 'string') return mark.flatMap((k) => marks(k, hold));
  return [...(hold(mark) ? [mark] : []), ...mark.slice(2).flatMap((k: any) => marks(k, hold))];
};
const texts = (mark: any): string[] => (typeof mark === 'string' ? [mark] : Array.isArray(mark) ? mark.slice(typeof mark[0] === 'string' ? 2 : 0).flatMap(texts) : []);
const packsIn = (svg: any) => marks(svg, (m) => typeof m[1]?.key === 'string' && m[1].key.startsWith('pk:'));
/** What may write: the gesture helper the frame gives a drawing (packs/walls/page/draw-inside.js), as it answers for a writer. */
const writer = ({ island = (_: string) => null, pack = (_: string) => false } = {}) => ({ on: (key: string) => (island(key) ? ['add'] : pack(key) ? ['toggle'] : []), hear: () => false });

test('the header shows the island pack, then what it requires, in order', () => {
  const svg = draw(answer).scene.svg, found = packsIn(svg);
  assert.deepEqual(found.map((m) => m[1].key), ['pk:e_buildisl:build', 'pk:e_buildisl:core', 'pk:e_buildisl:runs']);
  assert.deepEqual(found.map((m) => texts(m).at(-1)), ['Build', 'Core', 'Runs'], 'each its name, in quiet words');
  const xs = found.map((m) => Number(marks(m, (k) => k[0] === 'text')[0][1].x));
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], 'in a row, the island pack first');
  const name = marks(svg, (m) => m[1]?.class === 'lf-island-name')[0], nameX = Number(marks(name, (k) => k[0] === 'text')[0][1].x);
  assert.ok(xs[0] > nameX, 'after the island name');
});

test('the island frame is wide enough for its header', () => {
  const svg = draw(answer).scene.svg, found = packsIn(svg);
  const land = marks(svg, (m) => m[1]?.class === 'lf-land')[0], rect = marks(land, (k) => k[0] === 'rect')[0][1];
  const last = marks(found.at(-1), (k) => k[0] === 'rect')[0][1];
  assert.ok(Number(last.x) + Number(last.width) <= Number(rect.x) + Number(rect.width), 'the last mark stands inside the frame');
});

test('each mark says its state as a class, its tip the pack, its state and why', () => {
  const scene = draw(answer).scene, [build, , runs] = packsIn(scene.svg);
  assert.match(build[1].class, /st-active/);
  assert.match(runs[1].class, /st-off/);
  assert.match(texts(runs).join(' '), /Runs \(required\)/);
  assert.match(texts(runs).join(' '), /Off here: Turned off on this island/);
  for (const state of ['active', 'waiting', 'off']) assert.ok(scene.css.includes(`.lf-pack.st-${state} { --lf-pack: var(--ln-${house.pack_marks[state].hue}); }`), `the ${state} colour comes from the style`);
});

test('a toggle only where the session may write, naming its island and pack', () => {
  const read = packsIn(draw(answer).scene.svg);
  assert.ok(read.every((m) => !m[1].on.includes('toggle') && !m[1].pack), 'a reader has no button');
  const wrote = packsIn(draw(answer, writer).scene.svg).filter((m) => m[1].on.includes('toggle'));
  assert.ok(wrote.every((m) => m[1].item === 'e_buildisl'), 'each toggle names its island');
  assert.deepEqual(wrote.map((m) => m[1].pack), ['build', 'core'], 'a writer toggles each it may (runs is off, but not by this island)');
  assert.match(texts(wrote[0]).join(' '), /2 items would wait/, 'what turning it off sends waiting');
});

test("the kernel's own pack is no toggle, and says it is always on", () => {
  const a = { ...answer, islands: [{ ...answer.islands[0], pack: { ...answer.islands[0].pack, requires: [{ id: 'core', title: 'Core', state: 'active', kernel: true }] } }] };
  const [, core] = packsIn(draw(a, writer).scene.svg);
  assert.ok(!core[1].on.includes('toggle') && !core[1].pack, 'no button');
  assert.match(texts(core).join(' '), /Always on: the kernel's own/);
  assert.doesNotMatch(texts(core).join(' '), /Click/);
  // As the kernel half answers it (#427): an island that speaks core, its own pack the kernel's.
  const shared = { ...answer, islands: [{ ...answer.islands[0], pack: { id: 'core', title: 'Core', state: 'active', kernel: true, types: [], links: [], requires: [] } }] };
  const [own] = packsIn(draw(shared, writer).scene.svg);
  assert.ok(!own[1].on.includes('toggle'), "an island's own pack, when the kernel's, is no button either");
  assert.match(texts(own).join(' '), /Always on/);
});

test('turn on is offered only for a pack this island turned off', () => {
  const notHere = packsIn(draw(answer, writer).scene.svg).find((m) => m[1].key.endsWith(':runs'));
  assert.ok(!notHere[1].on.includes('toggle'), 'off for another reason (not in packs_off): no button');
  assert.doesNotMatch(texts(notHere).join(' '), /turn it on/);
  const turnedOff = { ...answer, items: answer.items.map((i: any) => (i.id === 'e_buildisl' ? { ...i, fields: { packs_off: ['runs'] } } : i)) };
  const here = packsIn(draw(turnedOff, writer).scene.svg).find((m) => m[1].key.endsWith(':runs'));
  assert.ok(here[1].on.includes('toggle') && here[1].pack === 'runs', 'in packs_off: a button');
  assert.match(texts(here).join(' '), /Click to turn it on here/);
  // An island item is not in its own answer: its packs_off rides on the answer's island.
  const byIsland = { ...answer, items: answer.items.filter((i: any) => i.id !== 'e_buildisl'), islands: [{ ...answer.islands[0], packs_off: ['runs'] }] };
  const there = packsIn(draw(byIsland, writer).scene.svg).find((m) => m[1].key.endsWith(':runs'));
  assert.ok(there?.[1].on.includes('toggle'), "in the answer's island's packs_off: a button, the island's item not drawn");
});

test('an island with no pack shows no marks', () => {
  const plain = { ...answer, islands: [{ id: 'e_buildisl', title: 'Build the thing' }], items: answer.items.map(({ waiting, ...i }: any) => i) };
  assert.equal(packsIn(draw(plain).scene.svg).length, 0);
});

test('a glyph is a few characters, else the initial', () => {
  assert.equal(glyphOf({ id: 'build', title: 'Build', glyph: '⚒' }), '⚒');
  assert.equal(glyphOf({ id: 'runs', title: 'runs' }), 'R');
  assert.equal(glyphOf({ id: 'x', title: 'X', glyph: 'abcdef' }), 'ab');
});

test('a waiting item is faint at its cell, why in its tip', () => {
  const p = draw(answer), svg = p.scene.svg;
  const step = marks(svg, (m) => m[1]?.key === 's:e_twozzzzz')[0], other = marks(svg, (m) => m[1]?.key === 's:e_onezzzzz')[0];
  assert.match(step[1].class, /\bwaiting\b/);
  assert.doesNotMatch(other[1].class, /\bwaiting\b/);
  assert.ok(p.scene.css.includes('.lf-step.waiting { opacity: var(--ln-flow-waiting); }'), 'its look is the style\'s');
  assert.equal(typeof house.numbers.flow_waiting, 'number');
  const tip = p.on({ name: 'enter', key: 's:e_twozzzzz' }).find((x: any) => x.tip)?.tip.mark;
  assert.match(texts(tip).join(' '), /Waiting on runs: Turned off on this island/);
});

test('an island over its cap says so after its packs, and only then', async () => {
  const { capText } = await import(pathToFileURL(join(import.meta.dirname, 'layouts/flow/pack-marks.js')).href);
  assert.equal(capText({ count: 178, most: 40 }), '178/40');
  assert.equal(capText({ count: 30, most: 40 }), '');
  assert.equal(capText({ count: 1966, most: null }), '', 'no cap, nothing said');
});
