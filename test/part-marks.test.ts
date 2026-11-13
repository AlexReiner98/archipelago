// A page's frozen marks (decision e_rhz4dvpk): the loader's root.part_marks runs the part filling a page slot in its
// own sandboxed process (packs/walls/kernel/part-box.ts) and checks what it answers, as the host would before drawing
// it. Run here on the reader's own part, and on parts that misbehave.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { partMarks } from '../packs/loader/kernel/part-marks.ts';
import { runPartOnce } from '../packs/walls/kernel/part-box.ts';

const page = { title: 'A guide', parts: [{ text: 'Hello.' }, { section: { id: 'e_bbbbbbbb', title: 'A view', body: '' } }], lenses: { e_bbbbbbbb: { items: [{ id: 'e_ffffffff', title: 'A task', type: 'task' }] } } };
/** A map whose registry holds one part filling `slot` from `folder`, as the loader reads one. */
const mapWith = (folder: string, files: Record<string, string>, slot = 'page.doc', marks = ['box', 'text', 'note', 'list', 'button', 'picture']) => ({
  map: { registry: { packs: [{ id: 'p', parts: [{ id: 'p.page', title: 'Page', slot, marks, modules: files }] }], folderOf: () => folder } },
});

test("the reader's part, run walled, answers checked marks, its title and its sheets", async () => {
  const answer = await partMarks(mapWith(join(import.meta.dirname, '..', 'packs', 'publish'), { 'index.js': 'parts/doc/index.js' }) as never, { slot: 'page.doc', input: { page, at: { published: true, frozen: true } } });
  assert.equal(answer?.part, 'p.page');
  assert.equal(answer?.title, 'A guide');
  assert.equal((answer?.marks as unknown[])[0], 'box');
  assert.deepEqual(Object.keys(answer?.sheets ?? {}), ['e_ffffffff']);
});

test('a part that reaches out, sends what cannot be drawn, or never answers is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-part-'));
  writeFileSync(join(dir, 'out.js'), "import { readFileSync } from 'node:fs';\nexport default () => ({ marks: ['text', readFileSync('/etc/hosts', 'utf8')] });\n");
  writeFileSync(join(dir, 'bad.js'), "export default () => ({ marks: ['script', 'alert(1)'] });\n");
  writeFileSync(join(dir, 'net.js'), 'export default () => ({ marks: ["text", typeof fetch + typeof process] });\n');
  writeFileSync(join(dir, 'slow.js'), 'export default () => { for (;;); };\n');
  await assert.rejects(runPartOnce(join(dir, 'out.js'), null), /only its own modules/);
  await assert.rejects(partMarks(mapWith(dir, { 'index.js': 'bad.js' }) as never, { slot: 'page.doc', input: null }), /cannot be drawn/);
  assert.deepEqual((await runPartOnce(join(dir, 'net.js'), null)).marks, ['text', 'undefinedundefined'], 'no network and no process in its globals');
  await assert.rejects(runPartOnce(join(dir, 'slow.js'), null, 1500), /longer than/);
  await assert.rejects(partMarks(mapWith(dir, { 'index.js': 'bad.js' }) as never, { slot: 'canvas', input: null }), /no login/);
  assert.equal(await partMarks(mapWith(dir, { 'index.js': 'bad.js' }, 'page.public') as never, { slot: 'page.doc', input: null }), null, 'no part fills the slot');
});
