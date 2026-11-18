// A pack's parts on an island (feature e_4r82mvf3, study e_a4zcgpda, verdict e_xqmtjtpw): a click on a pack whose parts
// the answer names asks the page to add `parts <pack> <island>` to the canvas query; the answer then holds its parts as
// an island of their own, placed by the layout like any island, what acts wired to what it names; a click on a part
// there toggles it in the island's parts_off. The island's key toggles its types and links, and counts the rest.

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
  { id: 'build.wave', kind: 'view', state: 'active', needs: ['build.feature'] },
  { id: 'build.lane', kind: 'type', state: 'off' },
  { id: 'build.gate', kind: 'rule', state: 'waiting', lacks: ['type:build.lane'], needs: ['build.lane'] },
  { id: 'build.feature', kind: 'type', state: 'active' },
  { id: 'build.hands_to', kind: 'link', state: 'active', needs: ['build.feature'] },
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
/** The answer with a pack's parts open as an island of the query (the term `parts <pack> e_buildisl`, ./parts-islands.js). */
const opened = (a: any, ...packs: string[]) => {
  const isle = a.islands[0], of = (id: string) => (id === isle.pack.id ? isle.pack : isle.pack.requires.find((r: any) => r.id === id));
  return { ...a, islands: [...a.islands, ...packs.map((id) => ({ id: `parts:e_buildisl:${id}`, title: `${of(id).title}: its parts`, parts_of: { island: 'e_buildisl', pack: id }, pack: of(id) }))] };
};
/** A parts island's rows, by the part each names. */
const ghostRows = (svg: any) => new Map(keyed(keyed(svg, 'gh:')[0] ?? [], 'pt:').map((m) => [m[1].key.split(':')[2], m]));
const xOf = (m: any) => Number(marks(m, (k) => k[0] === 'circle')[0][1].cx);
/** The land of an island, by its region's key: its first rect. */
const landOf = (svg: any, id: string) => marks(keyed(svg, `i:${id}`)[0], (k) => k[0] === 'rect')[0]?.[1];

test("a pack with parts asks the page to add its term to the canvas query, and none of its parts is drawn until the answer holds them", () => {
  const svg = draw(answer, writer).scene.svg, [build] = keyed(svg, 'pk:');
  assert.ok(build[1].on.includes('find') && !build[1].on.includes('toggle'), 'a click is a find: it is not the switch');
  assert.equal(build[1].find, 'parts build e_buildisl', 'the term the page adds or takes away');
  assert.equal(build[1].pack, undefined);
  assert.match(texts(build).join('\n'), /Click to open its parts/);
  assert.equal(keyed(svg, 'gh:').length + keyed(svg, 'pw:').length, 0);
});

test("the answer's parts island is placed by the layout as an island of its own: what is written left, what acts right", () => {
  const svg = draw(opened(answer, 'build'), writer).scene.svg;
  assert.equal(keyed(svg, 'gh:').length, 1, 'one parts island');
  assert.equal(keyed(svg, 'pw:')[0][1].key, 'pw:e_buildisl:build', 'the whole pack\'s switch beside its mark, open');
  assert.match(keyed(svg, 'pk:e_buildisl:build')[0][1].class, /\bopen\b/);
  assert.match(texts(keyed(svg, 'pk:e_buildisl:build')[0]).join('\n'), /Click to close its parts/);
  const rows = ghostRows(svg);
  assert.deepEqual([...rows.keys()].sort(), ['build.feature', 'build.gate', 'build.hands_to', 'build.lane', 'build.wave'], 'every part, named');
  assert.ok(xOf(rows.get('build.gate')) > xOf(rows.get('build.lane')), 'types and links left, rules and views right');
  // Laid out as an island: its parts do not lie on the island it is of.
  const land = landOf(svg, 'e_buildisl'), x0 = Number(land.x), x1 = x0 + Number(land.width), y0 = Number(land.y), y1 = y0 + Number(land.height);
  for (const m of rows.values()) {
    const [x, y] = [xOf(m), Number(marks(m, (k) => k[0] === 'circle')[0][1].cy)];
    assert.ok(!(x >= x0 && x <= x1 && y >= y0 && y <= y1), `${m[1].key} stands off the island's land`);
  }
  assert.equal(keyed(svg, 'i:parts:e_buildisl:build').length, 1, 'it is an island of the drawing');
  assert.equal(marks(keyed(svg, 'i:parts:e_buildisl:build')[0], (k) => k[1]?.class === 'lf-island-name').length, 0, 'with no name or key of its own: its parts\' title says it');
});

test('a wire runs from each part that acts to each type it names, each in its own channel', () => {
  const svg = draw(opened(answer, 'build'), writer).scene.svg;
  const wires = marks(keyed(svg, 'gh:')[0], (k) => k[0] === 'path' && String(k[1].class).startsWith('lf-ghost-wire'));
  assert.equal(wires.length, 2, 'build.gate to build.lane, build.wave to build.feature');
  const channels = wires.map((w: any) => /H(-?[\d.]+)V/.exec(String(w[1].d))![1]);
  assert.notEqual(channels[0], channels[1], 'no two parts\' wires share a stretch');
  const wire = wires.find((w: any) => /\bst-waiting\b/.test(w[1].class));
  assert.ok(wire, "a waiting rule's wire is drawn waiting");
  const rows = ghostRows(svg), gate = rows.get('build.gate');
  assert.equal(Number(/^M(-?[\d.]+) (-?[\d.]+)/.exec(String(wire[1].d))![2]), Number(marks(gate, (k) => k[0] === 'circle')[0][1].cy), 'from the row that acts');
});

test('two packs open are two parts islands', () => {
  const svg = draw(opened(answer, 'build', 'runs'), writer).scene.svg;
  assert.equal(keyed(svg, 'gh:').length, 2);
  assert.ok(keyed(svg, 'i:parts:e_buildisl:runs').length === 1 && keyed(svg, 'pt:e_buildisl:runs.run').length === 1);
});

test('the switch turns the whole pack, and each part on its island toggles in parts_off, where the session may write', () => {
  const svg = draw(opened(answer, 'build'), writer).scene.svg;
  const [sw] = keyed(svg, 'pw:'), by = ghostRows(svg);
  assert.ok(sw[1].on.includes('toggle') && sw[1].item === 'e_buildisl' && sw[1].pack === 'build', 'the switch names its island and pack');
  const feature = by.get('build.feature');
  assert.ok(feature[1].on.includes('toggle') && feature[1].item === 'e_buildisl' && feature[1].pack === 'build.feature', 'an active part toggles, naming the part, in the island it is of');
  assert.ok(by.get('build.lane')[1].on.includes('toggle'), 'off by this island: a button to turn it on');
  const gate = by.get('build.gate');
  assert.ok(!gate[1].on.includes('toggle') && gate[1].pack === undefined, 'a waiting part is no button: it waits on what it lacks');
  const elsewhere = { ...answer, islands: [{ ...answer.islands[0], parts_off: [] }] };
  assert.ok(!ghostRows(draw(opened(elsewhere, 'build'), writer).scene.svg).get('build.lane')[1].on.includes('toggle'), 'off, but not by this island: no button');
});

test("a reader sees a pack's parts but switches nothing", () => {
  const svg = draw(opened(answer, 'build')).scene.svg, rows = [...ghostRows(svg).values()];
  assert.equal(rows.length, 5);
  for (const m of [...keyed(svg, 'pw:'), ...rows]) assert.ok(!m[1].on.includes('toggle') && m[1].pack === undefined, `${m[1].key} is no button`);
});

test("off a part is dashed, waiting faded and dashed, in its state's colour, each with its kind's glyph", () => {
  const p = draw(opened(answer, 'build')), by = ghostRows(p.scene.svg);
  assert.match(by.get('build.lane')[1].class, /\bst-off\b/);
  assert.match(by.get('build.gate')[1].class, /\bst-waiting\b/);
  const glyph = (m: any) => texts(marks(m, (k) => k[0] === 'text')[0]).join('');
  for (const [id, m] of by) assert.equal(glyph(m), house.pack_marks.kinds[parts.find((x) => x.id === id)!.kind]);
  const css = p.scene.css;
  assert.ok(css.includes('.lf-part.st-waiting { opacity: var(--ln-flow-waiting); }'), 'waiting: faded, as a waiting step');
  for (const state of ['active', 'waiting', 'off']) assert.ok(css.includes(`.lf-part.st-${state} { --lf-pack: var(--ln-${house.pack_marks[state].hue}); }`), `the ${state} colour comes from the style`);
});

test("the island's key toggles a type it shows, and counts each pack's other parts", () => {
  const typed = {
    ...answer,
    islands: [{ ...answer.islands[0], pack: { ...answer.islands[0].pack, types: [{ id: 'build.feature', title: 'Feature', is: ['work'] }, { id: 'build.lane', title: 'Lane', is: ['work'] }] } }],
    items: [{ ...item('e_buildisl', 'Build the thing'), type: 'build.feature' }, { ...item('e_lanezzzz', 'A lane'), type: 'build.lane' }],
  };
  const svg = draw(typed, writer).scene.svg;
  const keyRow = (id: string) => keyed(svg, `pt:e_buildisl:${id}:key`)[0];
  assert.ok(keyRow('build.feature')[1].on.includes('toggle') && keyRow('build.feature')[1].pack === 'build.feature', 'a type in the key is a toggle naming its part');
  assert.match(keyRow('build.lane')[1].class, /\bst-off\b/, 'a type off here is drawn off in the key');
  const count = `${house.pack_marks.kinds.rule} 0/1 · ${house.pack_marks.kinds.view} 1`;
  assert.ok(texts(svg).includes(count), "a row for the pack's other parts, by kind, its mark the pack's glyph");
  assert.equal(keyed(draw(typed).scene.svg, 'pt:e_buildisl:build.feature:key')[0][1].pack, undefined, 'a reader toggles nothing');
});

test('a hover says what a pack gives and takes (with who gives it), and what a waiting one lacks', () => {
  const p = draw(opened(answer, 'build'));
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
  assert.ok(packsWidth(answer.islands[0].pack, z, null, measure, new Set(['build'])) > packsWidth(answer.islands[0].pack, z, null, measure));
  assert.equal(packsWidth(answer.islands[0].pack, z, null, measure, new Set(['nothing'])), packsWidth(answer.islands[0].pack, z, null, measure));
});

test('a parts island is shelved right after the island it is of, before any other', () => {
  const two = { ...answer, islands: [...answer.islands, { id: 'e_aaneighb', title: 'Neighbour' }], items: [{ ...item('e_aan1zzzz', 'Neighbour one'), island: 'e_aaneighb' }, ...answer.items] };
  const svg = draw(opened(two, 'build'), writer).scene.svg;
  const ghost = marks(keyed(svg, 'gh:')[0], (k) => k[1]?.class === 'lf-ghost')[0][1], own = landOf(svg, 'e_buildisl'), other = landOf(svg, 'e_aaneighb');
  const at = (r: any) => [Number(r.x), Number(r.y)];
  const [gx, gy] = at(ghost), [ox, oy] = at(own), [nx, ny] = at(other);
  assert.ok(gy > oy || gx > ox, 'after its own island');
  assert.ok(gy < ny || (gy === ny && gx < nx) || ny < oy || (ny === oy && nx < ox), 'and before the neighbour that comes after its own');
});
