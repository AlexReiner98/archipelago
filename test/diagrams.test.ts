// The diagrams made from the code: files and pack files in, draw.io XML out, with no database.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readModules } from '../src/diagram-modules.ts';
import { typeDiagram, type PackFile } from '../src/diagram-types.ts';
import { layers, mxfile, pageData, pageXml } from '../src/diagram-xml.ts';
import { diagramChange } from '../scripts/publish-diagrams.ts';
import { diagrams } from '../src/diagrams.ts';

const ROOT = join(import.meta.dirname, '..');
const cells = (xml: string, attr: 'vertex' | 'edge') => (xml.match(new RegExp(`${attr}="1"`, 'g')) ?? []).length;

test('imports are read: relative, dynamic and from a page; type-only imports and other folders are not', () => {
  const modules = readModules([
    { path: 'src/server.ts', text: "// One process.\nimport { a } from './pelago.ts';\nimport type { T } from './db.ts';\nconst m = await import('./db.ts');\nimport { z } from 'zod';\n" },
    { path: 'src/pelago.ts', text: "// The write path. More here.\nimport {\n  b,\n} from './db.ts';\n" },
    { path: 'src/db.ts', text: '' },
    { path: 'ui/index.html', text: '<script type="module" src="/app.js"></script>' },
    { path: 'ui/app.js', text: "import { h } from './base.js';\n" },
    { path: 'ui/base.js', text: '' },
    { path: 'packs/time/handler.js', text: "import { days } from './days.js';\n" },
    { path: 'packs/time/days.js', text: '' },
    { path: 'test/x.test.ts', text: "import '../src/db.ts';" },
  ]);
  const by = Object.fromEntries(modules.map((m) => [m.path, m]));
  assert.equal(by['test/x.test.ts'], undefined);
  assert.deepEqual(by['src/server.ts'].imports, [{ to: 'src/pelago.ts', dynamic: false }, { to: 'src/db.ts', dynamic: true }]);
  assert.deepEqual(by['src/pelago.ts'].imports, [{ to: 'src/db.ts', dynamic: false }]);
  assert.equal(by['src/pelago.ts'].about, 'The write path.');
  assert.equal(by['src/pelago.ts'].area, 'Write path and model');
  assert.equal(by['src/server.ts'].area, 'Server and surfaces', 'a file no rule names falls in the last area');
  assert.deepEqual(by['ui/index.html'].imports, [{ to: 'ui/app.js', dynamic: false }]);
  assert.deepEqual(by['packs/time/handler.js'].imports, [{ to: 'packs/time/days.js', dynamic: false }]);
  assert.equal(by['packs/time/handler.js'].area, 'time pack');
});

test('layers put what imports above what it imports, and a cycle does not stop them', () => {
  assert.deepEqual(layers(['c', 'b', 'a'], [['a', 'b'], ['b', 'c']]), [['a'], ['b'], ['c']]);
  const cyclic = layers(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']]);
  assert.deepEqual(cyclic.flat().sort(), ['a', 'b', 'c']);
  assert.equal(cyclic.length, 3);
});

test('the XML escapes what it is given and refuses an edge to nothing', () => {
  const page = { id: 'p', name: 'A & B', vertices: [{ id: 'v', label: '<b>"x"</b>', x: 0, y: 0, w: 10, h: 10, style: 'html=1;', tooltip: "it's" }], edges: [] };
  const xml = mxfile([page]);
  assert.match(xml, /name="A &amp; B"/);
  assert.match(xml, /label="&lt;b&gt;&quot;x&quot;&lt;\/b&gt;"/);
  assert.match(xml, /tooltip="it&apos;s"/);
  assert.throws(() => pageXml({ ...page, edges: [{ id: 'e', from: 'v', to: 'gone', style: '' }] }), /edges to no vertex: e/);
});

test('every type is drawn under what it extends, down to the kinds, and an unknown parent is refused', () => {
  const packs: PackFile[] = [
    { id: 'core', types: [{ id: 'work', kind: true }, { id: 'question', kind: true }, { id: 'system', kind: true }, { id: 'lens', extends: 'system' }], relations: [{ id: 'relates_to', root: true }, { id: 'about', root: true }] },
    { id: 'work', requires: ['core'], types: [{ id: 'work.task', extends: 'work', capabilities: { bound: {}, where: {} } }], relations: [{ id: 'work.based_on', extends: 'relates_to', from: ['*'], to: ['work.task'] }] },
    { id: 'lab', requires: ['core', 'work'], types: [{ id: 'lab.trial', extends: 'work.task' }], extend: { 'work.task': { fields: { cost: {} } } } },
  ];
  const [inheritance, relations, packMap] = typeDiagram(packs);
  const xml = pageXml(inheritance);
  for (const id of ['work', 'question', 'lens', 'work.task', 'lab.trial']) assert.match(xml, new RegExp(`id="t-${id.replace('.', '-')}"`));
  assert.equal(inheritance.edges.length, 3, 'one edge for each type that extends another');
  assert.ok(inheritance.edges.some((e) => e.from === 't-lab-trial' && e.to === 't-work-task'));
  const at = (id: string) => inheritance.vertices.find((v) => v.id === id)!;
  assert.ok(at('t-work').x < at('t-work-task').x && at('t-work-task').x < at('t-lab-trial').x, 'each level a column to the right');
  assert.match(at('t-work-task').label, /bound · where/);
  assert.match(at('t-work-task').label, /\+ fields from lab/);
  assert.equal(relations.edges.length, 1);
  assert.match(relations.vertices.find((v) => v.id === 'r-work-based-on')!.label, /\* → work\.task/);
  assert.equal(packMap.edges.length, 3, 'one edge for each pack a pack requires');
  assert.throws(() => typeDiagram([{ id: 'x', types: [{ id: 'x.a', extends: 'nothing' }] }]), /x\.a extends nothing/);
});

test('the diagrams of this repository are made whole, and the same each time', () => {
  const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((n) => (statSync(join(ROOT, dir, n)).isDirectory() ? walk(`${dir}/${n}`) : [`${dir}/${n}`]));
  const files = ['src', 'ui', 'packs'].flatMap(walk).map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }));
  const packs = readdirSync(join(ROOT, 'packs')).map((p) => JSON.parse(readFileSync(join(ROOT, 'packs', p, 'pack.json'), 'utf8')) as PackFile);
  const made = diagrams(files, packs);
  assert.deepEqual(Object.keys(made), ['modules.drawio', 'types.drawio']);
  assert.deepEqual(diagrams(files, packs), made);
  for (const f of files.filter((f) => /^src\/[^/]+\.ts$/.test(f.path))) assert.ok(made['modules.drawio'].includes(`>${f.path.slice(4)}<`) || made['modules.drawio'].includes(`label="${f.path.slice(4)}"`), `${f.path} is drawn`);
  const types = packs.flatMap((p) => p.types ?? []);
  assert.equal(cells(made['types.drawio'].split('</diagram>')[0], 'vertex'), types.length + 1, 'every type and the key');
});

test('a page as data: boxes placed on the page, what each is said as what it is, and plain words', () => {
  const data = pageData({
    id: 'p1',
    name: 'Server: GitHub',
    vertices: [
      { id: 'band', label: 'Server', x: 0, y: 100, w: 400, h: 200, style: 'shape=swimlane;startSize=30;fillColor=#ffffff;' },
      { id: 'a', label: '<b>github.ts</b><br>pushes', x: 20, y: 40, w: 120, h: 34, parent: 'band', style: 'rounded=1;fillColor=#f8cecc;', tooltip: 'src/github.ts', link: 'https://x/github.ts' },
      { id: 'b', label: 'hooks &amp; packs', x: 200, y: 40, w: 120, h: 34, parent: 'band', style: 'rounded=1;dashed=1;' },
      { id: 'n', label: 'A note', x: 0, y: 0, w: 100, h: 20, style: 'strokeColor=none;fillColor=none;' },
    ],
    edges: [{ id: 'e', from: 'a', to: 'b', style: 'dashed=1;opacity=70;', label: '3' }],
  });
  const by = Object.fromEntries(data.boxes.map((b) => [b.id, b]));
  assert.deepEqual([by.band.kind, by.band.head, by.a.kind, by.n.kind], ['area', 30, 'box', 'text']);
  assert.deepEqual([by.a.x, by.a.y], [20, 140], 'a box inside an area is placed on the page');
  assert.deepEqual([by.a.lines, by.a.bold, by.a.tone, by.a.link], [['github.ts', 'pushes'], true, 'warn', 'https://x/github.ts']);
  assert.deepEqual([by.b.lines, by.b.dashed], [['hooks & packs'], true]);
  assert.deepEqual(data.wires, [{ from: 'a', to: 'b', label: '3', dashed: true, faint: true }]);
  assert.deepEqual([data.width, data.height], [400, 300]);
});

test('publishing the diagrams makes each page once, finds it again by its id, redraws only what moved, and keeps what went as removed', () => {
  const page = (id: string, label = id) => ({ id, name: `Page ${id}`, width: 10, height: 10, boxes: [{ id: 'x', x: 0, y: 0, w: 10, h: 10, kind: 'box' as const, lines: [label] }], wires: [] });
  const first = diagramChange([{ file: 'modules.drawio', page: page('a') }, { file: 'types.drawio', page: page('t'), url: 'https://github.com/o/r/blob/c1/docs/diagrams/types.drawio' }], [], undefined, 'c1'.padEnd(40, '0'), 'e_feature1');
  assert.deepEqual(first.ops.map((o) => `${o.op} ${o.type ?? o.id ?? ''}`.trim()), ['create work.document', 'link part_of', 'create software.diagram', 'link part_of', 'create software.diagram', 'link part_of']);
  const doc = first.ops[0] as { body: string };
  assert.match(doc.body, /\n\nModules\n\{p0\}\n\nTypes\n\{p1\}$/, 'the document reads each page in, under its file');
  const made = (i: number) => (first.ops[i] as { props: { diagram: { key: string; commit: string; drawio?: string } } }).props.diagram;
  assert.deepEqual([made(4).key, made(4).drawio, made(4).commit.slice(0, 2)], ['types.drawio#t', 'https://github.com/o/r/blob/c1/docs/diagrams/types.drawio', 'c1']);
  assert.equal(made(2).drawio, undefined, 'no link where the committed file is not the one drawn');
  assert.equal(first.reason, 'Diagrams drawn at c100000');

  const kept = [
    { id: 'e_a0000001', title: 'Page a', status: 'current', props: { diagram: { ...page('a'), key: 'modules.drawio#a', commit: 'c1' } } },
    { id: 'e_t0000001', title: 'Page t', status: 'current', props: { diagram: { ...page('t'), key: 'types.drawio#t', commit: 'c1' } } },
  ];
  const body = 'The code drawn: its modules, what uses what, and its types down to the seven kinds. Made by npm run diagrams at each push to main; open a page to move about in it.\n\nModules\ne_a0000001\n\nTypes\ne_t0000001';
  assert.deepEqual(diagramChange([{ file: 'modules.drawio', page: page('a') }, { file: 'types.drawio', page: page('t') }], kept, { id: 'e_doc00001', body }, 'c2').ops, [], 'nothing moved, nothing sent');
  const next = diagramChange([{ file: 'modules.drawio', page: page('a', 'moved') }], kept, { id: 'e_doc00001', body }, 'c3');
  assert.deepEqual(next.ops.map((o) => [o.op, o.id, (o as { status?: string }).status]), [['update', 'e_a0000001', 'current'], ['update', 'e_t0000001', 'removed'], ['update', 'e_doc00001', undefined]]);
});
