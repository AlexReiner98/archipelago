// Parts declared in pack manifests (packs/loader/kernel/ui-parts.ts, task e_hnsknspb): a map pack's parts load when their
// shapes hold (the fields they read are on the type and asked for, the actions they send are their pack's, the slot
// they fill is open to them), a slot has one owner (packs/loader/kernel/slots.ts), and each part goes to the page by
// the hash of its modules: the owner's version of one over the pack's, and an island's pinned version's code there alone.

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readManifest } from '../packs/loader/kernel/manifest.ts';
import { islandRegistry } from '../packs/loader/kernel/island-pin.ts';
import { islandProblems, sharedOf } from '../packs/loader/kernel/islands.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { setIslands, setPack } from '../packs/loader/kernel/packstate.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { HOST_SLOTS } from '../packs/loader/kernel/slots.ts';
import { partsBy, partsFor } from '../packs/loader/kernel/ui-parts.ts';
import { parts } from '../packs/loader/kernel/parts-read.ts';
import { freshWith, human, make, packsWith } from './map.ts';

/** The test pack's own parts: the repository's packs ship parts beside them (findings's). */
const shelfs = <T extends { pack: string }>(parts: T[]) => parts.filter((p) => p.pack === 'shelf');

/** A pack of words another reads: a type of its own. */
const bin = {
  id: 'bin', version: '1.0.0', title: 'Bin', description: 'A type to be read.', requires: ['core'],
  types: [{ id: 'bin.box', title: 'Box', description: 'A box.', extends: 'record', fields: { size: { type: 'number', description: 'How big.' } } }],
};
/** A map pack with one action and one part that reads a task and sends the action, opening a slot of its own. */
const shelf = (over: Record<string, unknown> = {}, part: Record<string, unknown> = {}) => ({
  id: 'shelf', version: '1.0.0', title: 'Shelf', description: 'A part of the page.', requires: ['core'],
  actions: [{ id: 'shelf.put', title: 'Put', description: 'Put it.', verb: 'capture', input: { type: 'object', properties: {}, additionalProperties: false } }],
  parts: [{ id: 'shelf.row', title: 'Row', slot: 'sheet', reads: { task: ['title', 'status'] }, sends: ['shelf.put'], opens: ['shelf.end'], modules: { 'index.js': 'parts/row/index.js', 'look.js': 'parts/row/look.js' }, ...part }],
  ...over,
});

/** A folder of packs with these beside the repository's, the shelf's handler and its part's files written. */
function folder(...packs: Record<string, unknown>[]): string {
  const dir = packsWith(...(packs as unknown as PackFile[]));
  for (const p of packs.filter((m) => m.parts)) {
    writeFileSync(join(dir, String(p.id), 'handler.js'), 'export default { async "shelf.put"() { return {}; } };\n');
    mkdirSync(join(dir, String(p.id), 'parts', 'row'), { recursive: true });
    writeFileSync(join(dir, String(p.id), 'parts', 'row', 'index.js'), "import { look } from './look.js';\nexport default () => ['text', { look }, 'row'];\n");
    writeFileSync(join(dir, String(p.id), 'parts', 'row', 'look.js'), "export const look = 'plain';\n");
  }
  return dir;
}

test('parts is a key of the manifest, and a map pack’s alone', () => {
  const m = readManifest(JSON.stringify(shelf()), 'test');
  assert.equal(m.parts?.[0].slot, 'sheet');
  // A pack with a type that lives on an island and a part is told to split, as one with a layout is.
  const both = readManifest(JSON.stringify({ ...shelf(), types: bin.types }), 'test');
  const kernel = sharedOf([readManifest(JSON.stringify({ id: 'core', version: '1', title: 'core', shared: [] }), 'core')]);
  assert.match(islandProblems(both, kernel).join(), /a map pack \(actions, parts\): split it/);
  // The host's last page (time) became views (e_7tgvuyrs): PAGES is empty, and the host keeps its frame and pieces.
  assert.ok(HOST_SLOTS.includes('piece.figure') && HOST_SLOTS.includes('canvas') && !HOST_SLOTS.some((s) => s.startsWith('page.')), 'the host owns its frame and the pieces it draws, and no page');
});

test('a part loads when its shapes hold, and is refused with why when one does not', () => {
  const ok = new Registry(folder(shelf()));
  try {
    assert.equal(ok.states.get('shelf')?.state, 'active', ok.states.get('shelf')?.why ?? '');
  } finally {
    hostFor(ok).stop();
  }
  const refused = (part: Record<string, unknown>, over: Record<string, unknown> = {}, ...more: Record<string, unknown>[]) => () => new Registry(folder(shelf(over, part), ...more));
  assert.throws(refused({ id: 'row' }), /part "row" must be named "shelf.<name>"/);
  assert.throws(refused({ reads: { task: ['colour'] } }), /reads "colour" of "task", which has no such field/);
  assert.throws(refused({ reads: { nothing: ['title'] } }), /reads unknown type "nothing"/);
  assert.throws(refused({ reads: { 'bin.box': ['size'] } }, {}, bin), /reads "size" of "bin.box", bin's: ask for it, as type:bin.box or field:size@bin.box/);
  assert.throws(refused({ sends: ['shelf.take'] }), /sends "shelf.take", which is not an action of shelf/);
  assert.throws(refused({ sends: ['capture'] }), /not an action of shelf/);
  assert.throws(refused({ slot: 'other.place' }), /fills "other.place", which is not open to it/);
  assert.throws(refused({ opens: ['piece.figure'] }), /opens "piece.figure", which the host draws: one name, one owner/);
  assert.throws(refused({ opens: ['other.end'] }), /a slot it opens is named "shelf.<name>"/);
  assert.throws(refused({ modules: { 'look.js': 'parts/row/look.js' } }), /needs its modules, entered at index.js/);
  assert.throws(refused({ modules: { 'index.js': 'parts/row/gone.js' } }), /the pack has no file of/);
  assert.throws(refused({ query: { find: 'island {here}' } }), /query is a filter's terms/);
  assert.throws(refused({ query: { find: ['island {here}'], limit: 900 } }), /query's limit is a whole number up to 200/);
  assert.throws(refused({ query: { find: ['island {here}'] }, reads: undefined }), /has a query but reads no type/);
  // A named read is a view its pack answers, or one it asks for (runs answers turns; this pack does not).
  assert.throws(refused({ views: [{ name: 'turns', params: { run: '{here}' } }] }), /reads the view "turns", which shelf does not answer: ask for it, as service:answer.turns/);
  assert.throws(refused({ views: [] }), /views is a list of up to 4 named reads/);
  assert.throws(refused({ views: [{ name: 'Turns!' }] }), /a view it reads is named/);
  assert.throws(refused({ views: [{ name: 'turns', params: { run: { here: true } } }] }, { uses: ['service:answer.turns'] }), /params are words or numbers/);
  const viewing = new Registry(folder(shelf({ uses: ['service:answer.turns'] }, { views: [{ name: 'turns', params: { run: '{here}' } }] })));
  try {
    assert.equal(viewing.states.get('shelf')?.state, 'active', viewing.states.get('shelf')?.why ?? '');
    assert.deepEqual(shelfs(partsFor(viewing))[0].views, [{ name: 'turns', params: { run: '{here}' } }], 'the page is sent what it reads');
  } finally {
    hostFor(viewing).stop();
  }
  // Asked for, another pack's type reads; a slot asked for fills.
  const asked = new Registry(folder(shelf({ requires: ['core', 'field:size@bin.box', 'slot:shelf.end'] }, { reads: { 'bin.box': ['size', 'title'] }, slot: 'shelf.end', opens: [] }), bin));
  try {
    assert.equal(asked.states.get('shelf')?.state, 'waiting', 'it asks for a slot no pack opens');
    assert.match(asked.states.get('shelf')?.why ?? '', /needs slot:shelf.end/);
  } finally {
    hostFor(asked).stop();
  }
});

test('a slot has one owner: a second pack opening it waits', () => {
  const other = { ...shelf(), id: 'ledge', actions: [{ ...shelf().actions[0], id: 'ledge.put' }], parts: [{ ...shelf().parts[0], id: 'ledge.row', sends: ['ledge.put'], opens: ['piece.shelf_end'] }] };
  const first = { ...shelf(), parts: [{ ...shelf().parts[0], opens: ['piece.shelf_end'] }] };
  const dir = folder(first, other);
  writeFileSync(join(dir, 'ledge', 'handler.js'), 'export default { async "ledge.put"() { return {}; } };\n');
  const reg = new Registry(dir);
  try {
    // Packs load in order of their ids: ledge opens it first, and shelf waits.
    assert.equal(reg.states.get('ledge')?.state, 'active');
    assert.equal(reg.states.get('shelf')?.state, 'waiting');
    assert.match(reg.states.get('shelf')?.why ?? '', /slot:piece.shelf_end is ledge's: one pack owns a name/);
  } finally {
    hostFor(reg).stop();
  }
});

test('a part goes to the page by its hash: the owner’s version over it, an island’s version there alone', async () => {
  const dir = folder(shelf());
  const l = await freshWith(new Registry(dir));
  try {
    const [row] = shelfs(partsFor(l.registry));
    assert.deepEqual([row.id, row.pack, row.slot, row.sends, row.opens], ['shelf.row', 'shelf', 'sheet', ['shelf.put'], ['shelf.end']]);
    assert.match(row.modules!['index.js'], /look/);
    assert.equal(shelfs(partsFor(l.registry, [], [row.hash]))[0].modules, undefined, 'a page that has them is sent the hash alone');
    // The owner's version stands in module by module; retired, the part is not drawn.
    const mine = { is_open: true, props: { preset: 'shelf.row', code: { 'look.js': "export const look = 'bold';\n" } } };
    const changed = shelfs(partsFor(l.registry, [mine]))[0];
    assert.notEqual(changed.hash, row.hash);
    assert.equal(changed.modules!['index.js'], row.modules!['index.js']);
    const by = partsBy(l.registry, [mine]);
    assert.ok(by.has(row.hash) && by.has(changed.hash), 'served by hash: the pack’s and the owner’s');
    assert.equal(by.size, partsBy(l.registry).size + 1, 'the owner’s version adds its own');
    assert.deepEqual(shelfs(partsFor(l.registry, [{ ...mine, is_open: false }])), []);
    // Kept on the map, a part is an item of core's part type, its pack and slot as fields.
    await make(l, [{ op: 'create', type: 'part', title: 'Row, bolder', props: { preset: 'shelf.row', pack: 'shelf', slot: 'sheet', reads: { task: ['title'] }, code: mine.props.code } }]);

    // An island pinning a version of the pack with code of its own draws the part from that code; the rest of the map from the pack's.
    await setIslands(l, human, true);
    await setPack(l, human, { pack: 'shelf', on: true });
    const { trial, rest } = await make(l, [
      { op: 'create', ref: 'trial', type: 'island', title: 'Trial', props: { pack: 'core' } },
      { op: 'create', ref: 'rest', type: 'island', title: 'Rest', props: { pack: 'core' } },
    ]);
    const { v } = await make(l, [{ op: 'create', ref: 'v', type: 'pack', title: 'Shelf, bolder', props: { version_of: 'shelf', manifest: {}, code: { 'parts/row/look.js': "export const look = 'island';\n" } } }]);
    await make(l, [{ op: 'update', id: trial, props: { pack_version: v } }]);
    const there = shelfs(partsFor(await islandRegistry(l, trial)))[0];
    assert.match(there.modules!['look.js'], /island/);
    assert.equal(shelfs(partsFor(await islandRegistry(l, rest)))[0].hash, shelfs(partsFor(l.registry))[0].hash);
    assert.notEqual(there.hash, shelfs(partsFor(l.registry))[0].hash);

    // The page asks the same through root.parts (the view parts): the island's, what it refines, or as they ship.
    const asked = await parts({ caller: 'query', map: l }, { island: trial, have: [there.hash, 'not a hash'] });
    assert.equal(asked.refined?.pinned, v, 'the island pins a version that draws its own part');
    assert.deepEqual(asked.refined?.parts, ['shelf.row']);
    const shipped = await parts({ caller: 'query', map: l }, { island: trial, shipped: true });
    assert.equal(shipped.shipped, true);
    assert.equal(shelfs(shipped.parts)[0].hash, shelfs(partsFor(l.registry))[0].hash, 'as the pack ships it: no island version, no owner’s version');
    assert.ok(shelfs(shipped.parts)[0].modules, 'its modules come with it when the page has not got them');
    assert.equal((await parts({ caller: 'query', map: l }, {})).refined, undefined, 'with no island, nothing is said of one');

    // With the parts go the schema's words, as data: whole the first time, by their hash once the page holds them.
    const words = asked.words as { hash: string; types: Record<string, { title: string; open: string[]; closed: string[]; of?: string }>; links: Record<string, string> };
    assert.equal(words.types.task.title, 'Task');
    assert.ok(words.types.task.open.length && words.types.task.closed.length);
    assert.equal(words.links.depends_on, 'depends on');
    assert.deepEqual((await parts({ caller: 'query', map: l }, { island: trial, have: [words.hash] })).words, { hash: words.hash });
  } finally {
    hostFor(l.registry).stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
