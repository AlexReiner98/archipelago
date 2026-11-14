// map-code (scripts/map-code.ts): an item's code fields laid out as a pack folder, pushed back as one change, refused
// when the map moved since the pull, held where the map's rules hold code. Against an in-process map.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { agent, fresh, human, make } from './map.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { codeFields, fromFiles, record, toFiles } from '../scripts/map-code-files.ts';
import { pull, push, status, tryFolder, type Call } from '../scripts/map-code.ts';

const DRAW = 'export default function draw({ canvas }) {\n  canvas.getContext("2d");\n}\n';

test('code fields lay out as a pack folder, and the files come back as only the fields that changed', () => {
  const fields = codeFields({ code: { type: 'string', code: true }, modules: { type: 'json', code: true }, page_css: { type: 'string', code: true, css: true }, writes: { type: 'json' } });
  assert.deepEqual(fields.map((f) => `${f.name}:${f.kind}`), ['code:text', 'modules:files', 'page_css:text']);
  const laid = toFiles(fields, { code: DRAW, modules: { 'layout.js': 'export const a = 1;\n' }, page_css: 'h2 { color: red }' });
  assert.deepEqual(Object.keys(laid.files).sort(), ['index.js', 'layout.js', 'page_css.css']);
  const pulled = record({ url: 'x', item: 'e_1', type: 'layout', title: 'T' }, fields, laid);
  assert.deepEqual(fromFiles(pulled, laid.files), { props: {}, changed: [] });
  const edited = fromFiles(pulled, { ...laid.files, 'layout.js': 'export const a = 2;\n', 'extra.js': 'export {};\n', 'jsconfig.json': '{}' });
  assert.deepEqual(edited.changed, ['extra.js', 'layout.js']);
  assert.deepEqual(edited.props, { modules: { 'layout.js': 'export const a = 2;\n', 'extra.js': 'export {};\n' } });
  const { 'layout.js': _, ...gone } = laid.files;
  assert.deepEqual(fromFiles(pulled, gone).props, { modules: {} });
  assert.throws(() => toFiles(fields, { code: DRAW, modules: { 'index.js': 'x' } }), /both lay out index\.js/);
  assert.throws(() => toFiles(fields, { modules: { '../up.js': 'x' } }), /cannot be a file/);
});

test('pull, edit, push: one change; a map that moved refuses the push; an agent’s code waits for the human', async () => {
  const l = await fresh();
  const { l: id } = (await make(l, [{ op: 'create', ref: 'l', type: 'layout', title: 'Sample', props: { code: DRAW } }])) as any;
  const as = (who: typeof human): Call => (tool, body) => callTool(l, who, tool, body) as Promise<any>;
  const folder = mkdtempSync(join(tmpdir(), 'map-code-'));
  try {
    const p = await pull(as(human), 'local', id, folder);
    assert.deepEqual(Object.keys(p.fields.code.files), ['index.js']);
    assert.equal(readFileSync(join(folder, 'index.js'), 'utf8'), DRAW);
    assert.ok(existsSync(join(folder, '.map-code.json')));

    assert.equal((await push(as(human), folder)).status, 'unchanged');
    writeFileSync(join(folder, 'index.js'), DRAW.replace('2d', 'webgl2'));
    assert.deepEqual(await status(as(human), folder), { changed: ['index.js'], moved: [] });
    const done = await push(as(human), folder, { reason: 'test: a one-line fix' });
    assert.equal(done.status, 'applied');
    const after = (await callTool(l, human, 'query', { name: 'get', params: { id, full: true } })) as any;
    assert.match(after.entity.props.code, /webgl2/);
    assert.equal((await push(as(human), folder)).status, 'unchanged', 'the record moved to what was sent');

    // Someone changes the map under the folder: the next push is refused, and names what moved.
    await make(l, [{ op: 'update', id, props: { code: DRAW.replace('2d', 'bitmaprenderer') } }]);
    writeFileSync(join(folder, 'index.js'), DRAW.replace('2d', 'webgpu'));
    const refused = await push(as(human), folder);
    assert.equal(refused.status, 'moved');
    assert.deepEqual(refused.moved, ['code']);
    assert.match(((await callTool(l, human, 'query', { name: 'get', params: { id, full: true } })) as any).entity.props.code, /bitmaprenderer/);

    // The map takes the folder's edit another way (a try kept with the page's Save): the folder catches up, nothing moved.
    await make(l, [{ op: 'update', id, props: { code: DRAW.replace('2d', 'webgpu') } }]);
    assert.deepEqual(await status(as(human), folder), { changed: [], moved: [] });
    assert.equal((await push(as(human), folder)).status, 'unchanged');
    await make(l, [{ op: 'update', id, props: { code: DRAW.replace('2d', 'bitmaprenderer') } }]);
    writeFileSync(join(folder, 'index.js'), DRAW.replace('2d', 'webgl'));

    // Pull again refuses to throw away an edit not pushed; with it undone, the pull takes the map's.
    await assert.rejects(pull(as(human), 'local', id, folder), /changes not pushed/);
    writeFileSync(join(folder, 'index.js'), DRAW.replace('2d', 'webgpu'));
    await pull(as(human), 'local', id, folder);
    assert.match(readFileSync(join(folder, 'index.js'), 'utf8'), /bitmaprenderer/);

    // An agent's push of code waits for the human (code_runs), and the folder's record stays where it was.
    writeFileSync(join(folder, 'index.js'), DRAW.replace('2d', 'agent'));
    const held = await push(as(agent), folder);
    assert.equal(held.status, 'held');
    assert.deepEqual((await status(as(human), folder)).changed, ['index.js']);
    unlinkSync(join(folder, 'index.js'));
    assert.deepEqual((await status(as(human), folder)).changed, ['index.js']);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('try: the changed fields go to query look as tries, the picture is saved beside the folder, errors come back first', async () => {
  const l = await fresh();
  const { l: id } = (await make(l, [{ op: 'create', ref: 'l', type: 'layout', title: 'Sample', props: { code: DRAW } }])) as any;
  const real: Call = (tool, body) => callTool(l, human, tool, body) as Promise<any>;
  const folder = mkdtempSync(join(tmpdir(), 'map-code-'));
  const asked: any[] = [];
  // The look itself needs the server's Chrome (test/looks.test.ts): here, what is sent and what is done with the answer.
  const looking = (answer: Record<string, unknown>): Call => async (tool, body) => (tool === 'query' && body.name === 'look' ? (asked.push(body.params), answer) : real(tool, body));
  try {
    await pull(real, 'local', id, folder);
    const png = Buffer.from('a picture').toString('base64');
    const same = await tryFolder(looking({ state: 'drawn', image: { data: png, content_type: 'image/png' } }), folder);
    assert.deepEqual([same.changed, same.errors, asked[0].tries, asked[0].fresh, asked[0].style], [[], [], undefined, true, { id }], 'nothing changed: drawn as the map holds it');
    assert.equal(readFileSync(same.picture!, 'utf8'), 'a picture');
    writeFileSync(join(folder, 'index.js'), DRAW.replace('2d', 'webgl2'));
    const broken = await tryFolder(looking({ state: 'error', why: 'It threw', errors: ['It threw'] }), folder, { entity: id });
    assert.deepEqual([broken.changed, broken.errors, broken.picture], [['index.js'], ['It threw'], undefined]);
    assert.deepEqual(asked[1], { entity: id, tries: [{ item: id, field: 'code', value: DRAW.replace('2d', 'webgl2') }] });
    assert.deepEqual(await status(real, folder), { changed: ['index.js'], moved: [] }, 'a try sends nothing to the map');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
