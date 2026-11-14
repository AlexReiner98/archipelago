// Code written in the sheet (task e_pbdxaxdy), without a browser or a database: a code field opens in the host's code
// editor, Save sends only the passages that changed as `edit` ops the server applies (packs/write/kernel/edit.ts), and a
// text that moved since it was opened is said, with a way to open it as it is now.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { editAfter } from '../packs/write/kernel/edit.ts';
import { textDiff as serverDiff } from '../packs/surface/kernel/line-diff.ts';
import { schemaOf } from '../packs/loader/kernel/part-words.ts';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks, MARKS } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import page from '../packs/sheet/parts/page/index.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { changeCount, passagesOf, sha256, textDiff } from '../packs/sheet/parts/page/code.js';

type Edit = { field: string; file?: string; find: string; with: string; base?: string };
type Op = { op: string; id: string; edit?: Edit; props?: Record<string, unknown> };

const words = {
  types: {
    layout: { title: 'Layout', open: ['working'], closed: ['retired'], fields: { code: { type: 'string', code: true }, modules: { type: 'json', code: true } } },
    style: { title: 'Style', open: ['working'], closed: [], fields: { page_css: { type: 'string', code: true, css: true } } },
  },
  links: {},
};
const lines = (n: number) => Array.from({ length: n }, (_, i) => `const v${i % 9} = ${i};\n`).join('');
const code = `export default function draw() {\n${lines(300)}}\n`;
const layout = { id: 'e_aaaaaaaa', type: 'layout', title: 'Field', status: 'working', props: { code }, updated_at: '2026-11-14T10:00:00Z' };

/** Every input mark in a part's answer. */
const inputs = (m: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] => {
  if (Array.isArray(m)) {
    if (m[0] === 'input') out.push(m[1]);
    m.forEach((x) => inputs(x, out));
  }
  return out;
};
const noSlots = (m: unknown): unknown => (Array.isArray(m) ? (m[0] === 'slot' ? ['box'] : m.map(noSlots)) : m);
const apply = (text: string, ops: Op[]) => ops.reduce((t, o) => (o.edit?.file ? t : editAfter(t, o.edit!, 'code')), text);

test('the hash a passage is based on is the server’s sha256', () => {
  for (const s of ['', 'abc', 'é'.repeat(70), code]) assert.equal(sha256(s), createHash('sha256').update(s, 'utf8').digest('hex'));
});

test('passages make the new text of the old one, each found once, in the order the server applies them', () => {
  const now = code.replace('const v3 = 3;\n', 'const v3 = 33;\n').replace('const v1 = 280;\n', '').replace('}\n', '  return v1;\n}\n');
  const passages = passagesOf(code, now);
  assert.equal(passages.length, 3);
  assert.equal(apply(code, passages.map((p: Edit) => ({ op: 'update', id: 'x', edit: { ...p, field: 'code' } }))), now);
  assert.ok(passages.every((p: Edit) => p.find.length < 200), 'each passage is a few lines, not the module');
  assert.deepEqual(changeCount(code, now), { gone: 2, put: 2, passages: 3 });
  // Lines that repeat are found with more around them, never at another place.
  const rep = 'a();\n}\na();\n}\na();\n}\n';
  const cut = 'a();\n}\na();\n}\n}\n';
  assert.equal(apply(rep, passagesOf(rep, cut).map((p: Edit) => ({ op: 'update', id: 'x', edit: { ...p, field: 'code' } }))), cut);
});

test('the diff before Save says what the server’s line diffs say', () => {
  const now = code.replace('const v3 = 3;\n', 'const v3 = 33;\n').replace('const v1 = 280;\n', '').replace('const v6 = 6;\n', 'const v6 = 6;\nconst w = 1;\n');
  assert.deepEqual(textDiff(code, now), serverDiff(code, now));
  assert.deepEqual(textDiff('a\nb\n', 'a\nB\nc\n'), serverDiff('a\nb\n', 'a\nB\nc\n'));
});

test('a code field opens in the code editor, tried as it is written; CSS is not tried', () => {
  const p = page({ item: layout, words, views: {} }, { change: async () => ({ status: 'applied' }), keep: () => {}, state: () => {} });
  return p.on({ key: 'field-open:code', name: 'press' }).then((marks: unknown) => {
    assert.doesNotThrow(() => checkMarks(noSlots(marks), { kinds: Object.keys(MARKS) }));
    const input = inputs(marks).find((i) => i.key === 'field:code');
    assert.deepEqual({ kind: input?.kind, lang: input?.lang, preview: input?.preview, long: String(input?.value).length }, { kind: 'code', lang: 'js', preview: { item: layout.id, field: 'code' }, long: code.length });
    const style = { id: 'e_bbbbbbbb', type: 'style', title: 'House', props: { page_css: 'h2 { color: red; }' } };
    const q = page({ item: style, words, views: {} }, { change: async () => ({}), keep: () => {}, state: () => {} });
    return q.on({ key: 'field-open:page_css', name: 'press' }).then((m: unknown) => {
      const css = inputs(m).find((i) => i.key === 'field:page_css');
      assert.equal(css?.lang, 'css');
      assert.equal(css?.preview, undefined);
    });
  });
});

test('Save sends one edit for one line changed, based on the text as it was opened, and says the count first', async () => {
  const sent: Op[][] = [];
  const p = page({ item: layout, words, views: {} }, { change: async (ops: Op[]) => (sent.push(ops), { status: 'applied' }), keep: () => {}, state: () => {} });
  await p.on({ key: 'field-open:code', name: 'press' });
  const now = code.replace('const v5 = 5;\n', 'const v5 = 50;\n');
  const marks = await p.on({ key: 'field:code', name: 'edit', value: now });
  assert.ok(JSON.stringify(marks).includes('+1 −1'), 'the bar counts what Save changes');
  const shown = JSON.stringify(await p.on({ key: 'draft:diff', name: 'press' }));
  assert.ok(shown.includes('v5 = 5;') && shown.includes('v5 = 50;') && shown.includes('"tone":"ok"'), 'the diff is shown before Save');
  await p.on({ key: 'draft:save', name: 'press' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 1);
  const [op] = sent[0];
  assert.equal(op.props, undefined, 'the field is not sent whole');
  assert.equal(op.edit?.base, sha256(code));
  assert.ok(op.edit!.find.length < 100);
  assert.equal(apply(code, sent[0]), now);
});

test('modules by name: a pick for each, and an edit names its module', async () => {
  const mods = { ...layout, props: { modules: { 'index.js': code, 'a.js': 'export const a = 1;\n' } } };
  const sent: Op[][] = [];
  const p = page({ item: mods, words, views: {} }, { change: async (ops: Op[]) => (sent.push(ops), { status: 'applied' }), keep: () => {}, state: () => {} });
  let marks = await p.on({ key: 'field-open:modules', name: 'press' });
  assert.ok(inputs(marks).some((i) => i.key === 'code:modules:index.js' && i.kind === 'code'));
  marks = await p.on({ key: 'code-file:modules', name: 'pick', value: 'a.js' });
  assert.ok(inputs(marks).some((i) => i.key === 'code:modules:a.js'));
  await p.on({ key: 'code:modules:a.js', name: 'edit', value: 'export const a = 2;\n' });
  await p.on({ key: 'draft:save', name: 'press' });
  assert.deepEqual(sent[0], [{ op: 'update', id: mods.id, edit: { field: 'modules', file: 'a.js', find: 'export const a = 1;\n', with: 'export const a = 2;\n', base: sha256('export const a = 1;\n') } }]);
});

test('a base that moved is said plainly, and Reload opens the code as it is now', async () => {
  const p = page({ item: layout, words, views: {} }, { change: async () => ({ error: 'Change rejected:\n- op 1 (update): edit.base moved: code of "Field" has changed since it was read' }), keep: () => {}, state: () => {} });
  await p.on({ key: 'field-open:code', name: 'press' });
  await p.on({ key: 'field:code', name: 'edit', value: `${code}// mine\n` });
  let marks = await p.on({ key: 'draft:save', name: 'press' });
  const said = JSON.stringify(marks);
  assert.ok(said.includes('Changed since you opened it') && said.includes('draft:reload'));
  marks = await p.on({ key: 'draft:reload', name: 'press' });
  assert.ok(!JSON.stringify(marks).includes('draft:reload'));
  assert.equal(inputs(marks).find((i) => i.key === 'field:code')?.value, code);
});

test('the checker keeps lang and preview to code', () => {
  assert.throws(() => checkMarks(['input', { key: 'k', kind: 'text', lang: 'js' }]), /not code/);
  assert.throws(() => checkMarks(['input', { key: 'k', kind: 'code', preview: { item: 'nope', field: 'code' } }]), /preview/);
  assert.doesNotThrow(() => checkMarks(['input', { key: 'k', kind: 'code', lang: 'css', value: 'a {}' }]));
});

test('code as files, where its field takes them, is tried whole: the file written beside the others', async () => {
  const filed = { ...words, types: { ...words.types, layout: { ...words.types.layout, fields: { code: { type: 'json', code: true, files: true } } } } };
  const item = { ...layout, props: { code: { 'index.js': "import { a } from './a.js';\n", 'a.js': 'export const a = 1;\n' } } };
  const p = page({ item, words: filed, views: {} }, { change: async () => ({ status: 'applied' }), keep: () => {}, state: () => {} });
  let marks = await p.on({ key: 'field-open:code', name: 'press' });
  assert.doesNotThrow(() => checkMarks(noSlots(marks), { kinds: Object.keys(MARKS) }));
  assert.deepEqual(inputs(marks).find((i) => i.key === 'code:code:index.js')?.preview, { item: layout.id, field: 'code', file: 'index.js', others: { 'a.js': 'export const a = 1;\n' } });
  // Another file written: the one in sight is tried with it, though it is as it was opened.
  await p.on({ key: 'code:code:a.js', name: 'edit', value: 'export const a = 2;\n' });
  marks = await p.on({ key: 'code-file:code', name: 'pick', value: 'index.js' });
  assert.deepEqual(inputs(marks).find((i) => i.key === 'code:code:index.js')?.preview, { item: layout.id, field: 'code', file: 'index.js', others: { 'a.js': 'export const a = 2;\n' }, edited: true });
  // Modules of a field that does not take files are not tried.
  const mods = { ...layout, props: { modules: { 'index.js': 'x\n' } } };
  const q = page({ item: mods, words, views: {} }, { change: async () => ({}), keep: () => {}, state: () => {} });
  assert.equal(inputs(await q.on({ key: 'field-open:modules', name: 'press' })).find((i) => i.kind === 'code')?.preview, undefined);
  assert.throws(() => checkMarks(['input', { key: 'k', kind: 'code', preview: { item: layout.id, field: 'code', others: {} } }]), /preview/);
});

test('a part that reads items whole is told which code takes files and which is CSS', () => {
  const types = new Map([['layout', { id: 'layout', columns: {}, fields: { code: { type: 'string', code: true, files: true }, page_css: { type: 'string', code: true, css: true } }, capabilities: {} }]]);
  const said = schemaOf({ types } as never).types.layout.fields;
  assert.deepEqual([said.code.files, said.code.css, said.page_css.css, said.page_css.files], [true, undefined, true, undefined]);
});
