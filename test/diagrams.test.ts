// The diagrams made from the code: files and pack files in, draw.io XML out, with no database.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readModules } from '../src/diagram-modules.ts';
import { stackDiagram } from '../src/diagram-stack.ts';
import { typeDiagram, type PackFile } from '../src/diagram-types.ts';
import { layers, mxfile, pageXml } from '../src/diagram-xml.ts';
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
    { id: 'core', types: [{ id: 'work', kind: true }, { id: 'question', kind: true }, { id: 'lens', tier: 'system' }], relations: [{ id: 'relates_to', root: true }, { id: 'about', root: true }] },
    { id: 'work', requires: ['core'], types: [{ id: 'work.task', extends: 'work', capabilities: { bound: {}, where: {} } }], relations: [{ id: 'work.based_on', extends: 'relates_to', from: ['*'], to: ['work.task'] }] },
    { id: 'lab', requires: ['core', 'work'], types: [{ id: 'lab.trial', extends: 'work.task' }], extend: { 'work.task': { fields: { cost: {} } } } },
  ];
  const [inheritance, relations, packMap] = typeDiagram(packs);
  const xml = pageXml(inheritance);
  for (const id of ['work', 'question', 'lens', 'work.task', 'lab.trial']) assert.match(xml, new RegExp(`id="t-${id.replace('.', '-')}"`));
  assert.equal(inheritance.edges.length, 2, 'one edge for each type that extends another');
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

test('the stack names the services the plan does', () => {
  const xml = mxfile(stackDiagram());
  for (const name of ['Caddy', 'app-blue', 'app-green', 'Postgres 17', 'LiteLLM', 'pgBackRest', 'WireGuard', 'Uptime Kuma']) assert.match(xml, new RegExp(name));
});

test('the diagrams of this repository are made whole, and the same each time', () => {
  const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((n) => (statSync(join(ROOT, dir, n)).isDirectory() ? walk(`${dir}/${n}`) : [`${dir}/${n}`]));
  const files = ['src', 'ui', 'packs'].flatMap(walk).map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }));
  const packs = readdirSync(join(ROOT, 'packs')).map((p) => JSON.parse(readFileSync(join(ROOT, 'packs', p, 'pack.json'), 'utf8')) as PackFile);
  const made = diagrams(files, packs);
  assert.deepEqual(Object.keys(made), ['modules.drawio', 'types.drawio', 'stack.drawio']);
  assert.deepEqual(diagrams(files, packs), made);
  for (const f of files.filter((f) => /^src\/[^/]+\.ts$/.test(f.path))) assert.ok(made['modules.drawio'].includes(`>${f.path.slice(4)}<`) || made['modules.drawio'].includes(`label="${f.path.slice(4)}"`), `${f.path} is drawn`);
  const types = packs.flatMap((p) => p.types ?? []);
  assert.equal(cells(made['types.drawio'].split('</diagram>')[0], 'vertex'), types.length + 2, 'every type, the system tier heading and the key');
});
