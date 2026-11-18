// A pack's parts in an island's header (feature e_4r82mvf3, study e_a4zcgpda): a click on a pack whose parts the answer
// names opens its parts as a ghost island beside the island, what acts wired to what it names, and the
// island's key toggles its types and links; a click on a part is a toggle the page answers (packs/walls/page/marks-toggle.js) in the island's parts_off. Off a part
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

/** A ghost island's rows, by the part each names. */
const ghostRows = (head: any) => new Map(keyed(keyed(head, 'gh:')[0] ?? [], 'pt:').map((m) => [m[1].key.split(':')[2], m]));
const xOf = (m: any) => Number(marks(m, (k) => k[0] === 'circle')[0][1].cx);

test("a click opens the pack's parts as a ghost island beside the island: what is written left, what acts right; again, closes it", () => {
  const p = draw(answer, writer);
  const head = click(p, 'pk:e_buildisl:build');
  assert.equal(keyed(head, 'gh:').length, 1, 'one ghost island');
  assert.equal(keyed(head, 'pw:')[0][1].key, 'pw:e_buildisl:build', 'the switch for the whole pack beside its mark');
  const rows = ghostRows(head);
  assert.deepEqual([...rows.keys()].sort(), ['build.feature', 'build.gate', 'build.hands_to', 'build.lane', 'build.wave'], 'every part, named');
  assert.ok(xOf(rows.get('build.lane')) === xOf(rows.get('build.hands_to')) && xOf(rows.get('build.gate')) === xOf(rows.get('build.wave')), 'two columns');
  assert.ok(xOf(rows.get('build.gate')) > xOf(rows.get('build.lane')), 'types and links left, rules and views right');
  assert.deepEqual(rows.get('build.lane') && texts(marks(rows.get('build.lane'), (k) => k[1]?.class === 'lf-part-name')[0]), ['build.lane']);
  assert.match(texts(keyed(head, 'pk:')[0]).join('\n'), /Click to close its parts/);
  assert.equal(keyed(click(p, 'pk:e_buildisl:build'), 'gh:').length, 0, 'a second click closes it');
});

test('a wire runs from each part that acts to each type it names, across the gap', () => {
  const head = click(draw(answer, writer), 'pk:e_buildisl:build');
  const wires = marks(keyed(head, 'gh:')[0], (k) => k[0] === 'path' && String(k[1].class).startsWith('lf-ghost-wire'));
  assert.equal(wires.length, 2, 'build.gate to build.lane, build.wave to build.feature');
  const rows = ghostRows(head), lane = rows.get('build.lane'), gate = rows.get('build.gate');
  const wire = wires.find((w: any) => /\bst-waiting\b/.test(w[1].class));
  assert.ok(wire, "a waiting rule's wire is drawn waiting");
  const d = String(wire[1].d), [, x1, y1] = /^M(-?[\d.]+) (-?[\d.]+)/.exec(d)!.map(Number), end = /H(-?[\d.]+)$/.exec(d)!;
  assert.ok(x1 < xOf(gate) && Number(end[1]) > xOf(lane), 'out of the right column, into the left');
  assert.equal(y1, Number(marks(gate, (k) => k[0] === 'circle')[0][1].cy), 'from the row that acts');
});

test('opening one pack closes another, and each pack opens its own', () => {
  const p = draw(answer, writer);
  click(p, 'pk:e_buildisl:build');
  const runs = click(p, 'pk:e_buildisl:runs');
  assert.deepEqual([...ghostRows(runs).keys()], ['runs.run']);
});

test('the switch turns the whole pack, and each part on the ghost toggles in parts_off, where the session may write', () => {
  const head = click(draw(answer, writer), 'pk:e_buildisl:build');
  const [sw] = keyed(head, 'pw:'), by = ghostRows(head);
  assert.ok(sw[1].on.includes('toggle') && sw[1].item === 'e_buildisl' && sw[1].pack === 'build', 'the switch names its island and pack');
  assert.match(texts(sw).join('\n'), /Click to turn the whole pack off here/);
  const feature = by.get('build.feature');
  assert.ok(feature[1].on.includes('toggle') && feature[1].item === 'e_buildisl' && feature[1].pack === 'build.feature', 'an active part toggles, naming the part');
  assert.ok(by.get('build.lane')[1].on.includes('toggle'), 'off by this island: a button to turn it on');
  const gate = by.get('build.gate');
  assert.ok(!gate[1].on.includes('toggle') && gate[1].pack === undefined, 'a waiting part is no button: it waits on what it lacks');
  const elsewhere = { ...answer, islands: [{ ...answer.islands[0], parts_off: [] }] };
  const off = ghostRows(click(draw(elsewhere, writer), 'pk:e_buildisl:build')).get('build.lane');
  assert.ok(!off[1].on.includes('toggle'), 'off, but not by this island: no button');
});

test("a reader opens a pack's parts but switches nothing", () => {
  const head = click(draw(answer), 'pk:e_buildisl:build'), rows = [...ghostRows(head).values()];
  assert.equal(rows.length, 5);
  for (const m of [...keyed(head, 'pw:'), ...rows]) assert.ok(!m[1].on.includes('toggle') && m[1].pack === undefined, `${m[1].key} is no button`);
});

test("off a part is dashed, waiting faded and dashed, in its state's colour, each with its kind's glyph", () => {
  const p = draw(answer), head = click(p, 'pk:e_buildisl:build'), by = ghostRows(head);
  assert.match(by.get('build.lane')[1].class, /\bst-off\b/);
  assert.match(by.get('build.gate')[1].class, /\bst-waiting\b/);
  const glyph = (m: any) => texts(marks(m, (k) => k[0] === 'text')[0]).join('');
  for (const [id, m] of by) assert.equal(glyph(m), house.pack_marks.kinds[parts.find((x) => x.id === id)!.kind]);
  const css = p.scene.css;
  assert.ok(css.includes('.lf-part.st-waiting { opacity: var(--ln-flow-waiting); }'), 'waiting: faded, as a waiting step');
  assert.ok(css.includes('.lf-ghost-wire.st-waiting, .lf-ghost-wire.st-off { stroke-dasharray: var(--ln-flow-dash-held); opacity: var(--ln-flow-waiting); }'));
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
  const count = texts(svg).find((t) => t.startsWith('Build: '));
  assert.equal(count, `Build: ${house.pack_marks.kinds.rule} 0/1 · ${house.pack_marks.kinds.view} 1`, "a row for the pack's other parts, by kind");
  assert.equal(keyed(draw(typed).scene.svg, 'pt:e_buildisl:build.feature:key')[0][1].pack, undefined, 'a reader toggles nothing');
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
