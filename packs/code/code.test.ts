// The Software island's vocabulary, checked from its file alone (no kernel, no database): it holds only vocabulary,
// views and instructions, builds on core's shared set and core's link types, and every view and instruction names only
// its own vocabulary or the shared set. What the registry and a workspace make of it is test/code-island.test.ts.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const read = (id: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', id, 'pack.json'), 'utf8'));
const code = read('code');
const core = read('core');
const own = new Set<string>(code.types.map((t: { id: string }) => t.id));
const ownLinks = new Set<string>(code.links.map((l: { id: string }) => l.id));
const shared = new Set<string>(core.shared);
const fine = (t: string) => t === '*' || own.has(t) || shared.has(t);

test('the file holds vocabulary, views and instructions, on core alone', () => {
  assert.deepEqual(Object.keys(code).sort(), ['description', 'id', 'links', 'requires', 'styles', 'title', 'types', 'version', 'views']);
  assert.deepEqual(code.requires, ['core']);
  assert.deepEqual(code.styles.map((s: { type: string }) => s.type).filter((t: string) => !['lens', 'instruction'].includes(t)), [], 'no looks');
  assert.deepEqual(code.views.filter((v: { form?: string }) => !['tree', 'screen', 'attention'].includes(v.form ?? '')).map((v: { id: string }) => v.id), [], 'no computed reads');
});

test('each type extends the shared set or one of its own, and adds to no other pack’s', () => {
  for (const t of code.types) {
    assert.ok(!('of' in t), `${t.id} adds to no other type`);
    assert.ok(fine(t.extends), `${t.id} extends ${t.extends}`);
    assert.ok(!/^code_/.test(t.id), `${t.id} takes the bare name: the software pack declares none now`);
  }
});

test('its links extend core’s, and their ends are its own types or the shared set', () => {
  const coreLinks = new Set(core.links.map((l: { id: string }) => l.id));
  for (const l of code.links) {
    assert.ok(coreLinks.has(l.extends) || ownLinks.has(l.extends), `${l.id} extends ${l.extends}`);
    for (const end of [...l.from, ...l.to]) assert.ok(fine(end), `${l.id} names ${end}`);
  }
});

test('its views and instructions name only its vocabulary and the shared set', () => {
  const terms = [
    ...code.styles.filter((s: { type: string }) => s.type === 'lens').flatMap((s: any) => [...s.props.filter.find, ...(s.props.walk?.over ?? [])]),
    ...code.views.filter((v: { form?: string }) => v.form === 'screen').flatMap((v: any) => v.pieces.flatMap((p: any) => (p.lens ? [...p.lens.filter.find, ...(p.lens.walk?.over ?? [])] : []))),
  ];
  const coreLinks = new Set(core.links.map((l: { id: string }) => l.id));
  for (const t of terms) {
    const type = /^type (\S+)$/.exec(t)?.[1];
    if (type) assert.ok(fine(type), t);
    const link = /^([a-z_]+)[<>]/.exec(t)?.[1];
    if (link) assert.ok(coreLinks.has(link) || ownLinks.has(link), t);
  }
  const tree = code.views.find((v: { form?: string }) => v.form === 'tree');
  for (const t of [...tree.roots, ...tree.branches, ...tree.work]) assert.ok(fine(t), `the roadmap names ${t}`);
  for (const v of code.views.filter((v: { on?: string[]; of?: string }) => v.on || v.of)) for (const t of [...(v.on ?? []), ...(v.of ? [v.of] : [])]) assert.ok(own.has(t), `${v.id} is on ${t}`);
  const said = code.styles.filter((s: { type: string }) => s.type === 'instruction');
  assert.ok(said.length && said.every((s: any) => s.props.for.join() === 'session_start'), 'said when a session starts');
});
