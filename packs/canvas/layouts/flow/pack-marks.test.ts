// A pack's parts in an island's header (feature e_4r82mvf3, lane e_d2s3ekhz): a click on a pack whose parts the answer
// names opens them as a row of smaller marks after it, grouped by kind, the first the switch for the whole pack; a
// click on a part is a toggle the page answers (packs/walls/page/marks-toggle.js) in the island's parts_off. Off a part
// is dashed, waiting faded and dashed; its tip says what it gives and lacks. Drawn from a fixture answer, as the kernel
// half (Lane 3) is to give it.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..', '..');
const pack = JSON.parse(readFileSync(join(root, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'pelago-pack-parts-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(root, file as string), join(laid, name));
const [{ picture }, { partsOf, packsWidth }] = await Promise.all(['index.js', 'pack-marks.js'].map((n) => import(pathToFileURL(join(laid, n)).href)));
const measure = (t: string, px: number) => t.length * px * 0.55;

const item = (id: string, title: string) => ({ id, type: 'task', is: ['work'], title, open: true, status: 'todo', phase: 'not_started', island: 'e_buildisl' });
const parts = [
  { id: 'build.wave', kind: 'view', state: 'active' },
  { id: 'build.lane', kind: 'type', state: 'off' },
  { id: 'build.gate', kind: 'rule', state: 'waiting', lacks: ['type:build.lane'] },
  { id: 'build.feature', kind: 'type', state: 'active' },
  { id: 'build.hands_to', kind: 'link', state: 'active' },
];
const answer = {
  islands: [{
    id: 'e_buildisl', title: 'Build the thing', focus: true, parts_off: ['build.lane'],
    pack: {
      id: 'build', title: 'Build', glyph: '⚒', state: 'active', types: [], links: [], parts,
      provides: ['type:build.feature', 'type:build.lane', 'link:build.hands_to'], consumes: [{ name: 'type:task', by: 'core' }, { name: 'link:depends_on' }],
      requires: [{ id: 'runs', title: 'Runs', state: 'waiting', lacks: ['type:run'], parts: [{ id: 'runs.run', kind: 'type', state: 'waiting', lacks: ['type:session'] }] }],
    },
  }],
  items: [item('e_buildisl', 'Build the thing'), item('e_onezzzzz', 'Make it')],
  links: [],
};
const writer = ({ island = (_: string) => null, pack = (_: string) => false } = {}) => ({ on: (key: string) => (island(key) ? ['add'] : pack(key) ? ['toggle'] : []), hear: () => false });
const draw = (a: any, gestures?: any) => picture({ answer: a, style: house, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {}, ...(gestures && { gestures }) });

const marks = (mark: any, hold: (m: any) => boolean): any[] => {
  if (!Array.isArray(mark)) return [];
  if (typeof mark[0] !== 'string') return mark.flatMap((k) => marks(k, hold));
  return [...(hold(mark) ? [mark] : []), ...mark.slice(2).flatMap((k: any) => marks(k, hold))];
};
const keyed = (svg: any, prefix: string) => marks(svg, (m) => typeof m[1]?.key === 'string' && m[1].key.startsWith(prefix));
const texts = (mark: any): string[] => (typeof mark === 'string' ? [mark] : Array.isArray(mark) ? mark.slice(typeof mark[0] === 'string' ? 2 : 0).flatMap(texts) : []);
const cx = (mark: any) => Number(marks(mark, (k) => k[0] === 'circle')[0][1].cx);
const r = (mark: any) => Number(marks(mark, (k) => k[0] === 'circle')[0][1].r);
/** Click a pack's mark: the header the patch draws in its place. */
const click = (p: any, key: string) => {
  const patches = p.on({ name: 'click', key });
  const head = patches.find((x: any) => x.key === 'ph:e_buildisl');
  assert.ok(head, 'the header is drawn again');
  return head.mark;
};

test('closed, a pack with parts is a button that opens them, and none of its parts is drawn', () => {
  const svg = draw(answer, writer).scene.svg, [build] = keyed(svg, 'pk:');
  assert.ok(build[1].on.includes('click') && !build[1].on.includes('toggle'), 'a click opens it: it is not the switch');
  assert.equal(build[1].pack, undefined);
  assert.match(texts(build).join('\n'), /Click to open its parts/);
  assert.match(texts(build).join('\n'), /Turn it off here from its first part/, 'its tip says where the whole pack is turned off');
  assert.equal(keyed(svg, 'pt:').length + keyed(svg, 'pw:').length, 0);
  assert.equal(keyed(svg, 'ph:').length, 1, 'the header is one group a click can replace');
});

test('a click opens its parts after it, the switch first, grouped by kind; again, closes them', () => {
  const p = draw(answer, writer), before = keyed(p.scene.svg, 'pk:').map(cx);
  const head = click(p, 'pk:e_buildisl:build');
  const [sw] = keyed(head, 'pw:'), row = keyed(head, 'pt:'), packs = keyed(head, 'pk:');
  assert.equal(sw[1].key, 'pw:e_buildisl:build');
  assert.deepEqual(row.map((m) => m[1].key.split(':')[2]), ['build.lane', 'build.feature', 'build.hands_to', 'build.gate', 'build.wave'], 'types, links, rules, views: each kind in the answer\'s order');
  assert.deepEqual(partsOf(answer.islands[0].pack).map((x: any) => x.kind), ['type', 'type', 'link', 'rule', 'view']);
  const xs = [cx(packs[0]), cx(sw), ...row.map(cx)];
  assert.ok(xs.every((x, k) => !k || x > xs[k - 1]), 'in a row, after the pack');
  assert.ok(cx(packs[1]) > xs.at(-1)!, 'the packs after it stand past its row');
  assert.ok(cx(packs[1]) > before[1]);
  const step = (a: any, b: any) => cx(b) - cx(a);
  assert.ok(step(row[1], row[2]) > step(row[0], row[1]), 'a wider gap between kinds');
  assert.ok(r(row[0]) < r(packs[0]), 'a part is smaller than a pack');
  assert.equal(r(row[0]), house.sizes.flow_island_part_mark / 2, 'its size is the style\'s');
  assert.match(packs[0][1].class, /\bopen\b/);
  assert.match(texts(packs[0]).join('\n'), /Click to close its parts/);
  const shut = click(p, 'pk:e_buildisl:build');
  assert.equal(keyed(shut, 'pt:').length, 0, 'a second click closes them');
  assert.deepEqual(keyed(shut, 'pk:').map(cx), before);
});

test('opening one pack closes another, and each pack opens its own', () => {
  const p = draw(answer, writer);
  click(p, 'pk:e_buildisl:build');
  const runs = click(p, 'pk:e_buildisl:runs');
  assert.deepEqual(keyed(runs, 'pt:').map((m) => m[1].key), ['pt:e_buildisl:runs.run']);
});

test('the switch turns the whole pack, and each part toggles in parts_off, where the session may write', () => {
  const head = click(draw(answer, writer), 'pk:e_buildisl:build');
  const [sw] = keyed(head, 'pw:'), by = new Map(keyed(head, 'pt:').map((m) => [m[1].key.split(':')[2], m]));
  assert.ok(sw[1].on.includes('toggle') && sw[1].item === 'e_buildisl' && sw[1].pack === 'build', 'the switch names its island and pack');
  assert.match(texts(sw).join('\n'), /Click to turn the whole pack off here/);
  const feature = by.get('build.feature');
  assert.ok(feature[1].on.includes('toggle') && feature[1].item === 'e_buildisl' && feature[1].pack === 'build.feature', 'an active part toggles, naming the part');
  assert.match(texts(feature).join('\n'), /Click to turn it off here/);
  const lane = by.get('build.lane');
  assert.ok(lane[1].on.includes('toggle'), 'off by this island: a button to turn it on');
  assert.match(texts(lane).join('\n'), /Click to turn it on here/);
  const gate = by.get('build.gate');
  assert.ok(!gate[1].on.includes('toggle') && gate[1].pack === undefined, 'a waiting part is no button: it waits on what it lacks');
  const elsewhere = { ...answer, islands: [{ ...answer.islands[0], parts_off: [] }] };
  const off = keyed(click(draw(elsewhere, writer), 'pk:e_buildisl:build'), 'pt:e_buildisl:build.lane')[0];
  assert.ok(!off[1].on.includes('toggle'), 'off, but not by this island: no button');
});

test('a reader opens a pack\'s parts but switches nothing', () => {
  const head = click(draw(answer), 'pk:e_buildisl:build');
  for (const m of [...keyed(head, 'pw:'), ...keyed(head, 'pt:')]) assert.ok(!m[1].on.includes('toggle') && m[1].pack === undefined, `${m[1].key} is no button`);
  assert.doesNotMatch(texts(keyed(head, 'pt:')).join('\n'), /Click/);
});

test('off a part is dashed, waiting faded and dashed, in its state\'s colour', () => {
  const p = draw(answer), head = click(p, 'pk:e_buildisl:build'), by = new Map(keyed(head, 'pt:').map((m) => [m[1].key.split(':')[2], m]));
  assert.match(by.get('build.lane')[1].class, /\bst-off\b/);
  assert.match(by.get('build.gate')[1].class, /\bst-waiting\b/);
  assert.match(by.get('build.feature')[1].class, /\bk-type\b/);
  const css = p.scene.css;
  assert.ok(css.includes('.lf-pack.st-off circle, .lf-part.st-off circle { stroke-dasharray: var(--ln-flow-dash-held); }'), 'off: dashed');
  assert.ok(css.includes('.lf-part.st-waiting { opacity: var(--ln-flow-waiting); }'), 'waiting: faded, as a waiting step');
  assert.ok(css.includes('.lf-part.st-waiting circle { stroke-dasharray: var(--ln-flow-dash-held); }'), 'waiting: dashed');
  for (const state of ['active', 'waiting', 'off']) assert.ok(css.includes(`.lf-part.st-${state} { --lf-pack: var(--ln-${house.pack_marks[state].hue}); }`), `the ${state} colour comes from the style`);
});

test('each part shows its kind\'s glyph from the style', () => {
  const head = click(draw(answer), 'pk:e_buildisl:build');
  const glyph = (m: any) => texts(marks(m, (k) => k[0] === 'text')[0]).join('');
  assert.equal(glyph(keyed(head, 'pw:')[0]), house.pack_marks.kinds.pack);
  for (const m of keyed(head, 'pt:')) assert.equal(glyph(m), house.pack_marks.kinds[parts.find((x) => x.id === m[1].key.split(':')[2])!.kind]);
});

test('a hover says what a pack gives and takes (with who gives it), and what a waiting one lacks', () => {
  const p = draw(answer);
  const tipOf = (key: string) => texts(p.on({ name: 'enter', key }).find((x: any) => x.tip)?.tip.mark).join('\n');
  const build = tipOf('pk:e_buildisl:build');
  assert.match(build, /Gives type:build\.feature, type:build\.lane, link:build\.hands_to/);
  assert.match(build, /Takes type:task \(core\), link:depends_on/);
  assert.doesNotMatch(build, /Lacks/, 'on here, it lacks nothing');
  assert.match(tipOf('pk:e_buildisl:runs'), /Lacks type:run/);
  // A part's tip is there before its row is opened, so a hover over it after the click has it.
  const gate = tipOf('pt:e_buildisl:build.gate');
  assert.match(gate, /^build\.gate\nRule: waiting\nLacks type:build\.lane$/);
  assert.match(tipOf('pt:e_buildisl:build.lane'), /Type: off here\nGives type:build\.lane/);
  // Each row of a tip is one line: cut, never wrapped.
  assert.ok(p.scene.css.includes('.lf-tip .lf-tip-row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }'));
});

test('a pack the answer names no parts of is its own switch, as before; the kernel\'s opens nothing', () => {
  const plain = { ...answer, islands: [{ ...answer.islands[0], pack: { ...answer.islands[0].pack, parts: undefined, requires: [{ id: 'core', title: 'Core', state: 'active', kernel: true, parts }] } }] };
  const p = draw(plain, writer), [build, core] = keyed(p.scene.svg, 'pk:');
  assert.ok(build[1].on.includes('toggle') && build[1].pack === 'build' && !build[1].on.includes('click'));
  assert.ok(!core[1].on.includes('click') && !core[1].on.includes('toggle'), 'the kernel\'s own: no parts to open');
  assert.equal(keyed(p.scene.svg, 'pw:').length, 0, 'and no row to open');
});

test('the open row is counted in how wide the header stands', () => {
  const z = (n: string) => house.sizes[`flow_${n}`];
  assert.ok(packsWidth(answer.islands[0].pack, z, null, measure, 'build') > packsWidth(answer.islands[0].pack, z, null, measure));
  assert.equal(packsWidth(answer.islands[0].pack, z, null, measure, 'nothing'), packsWidth(answer.islands[0].pack, z, null, measure));
});
