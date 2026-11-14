// Code on the log as files by hash (task e_ubdb4u7c, packs/seal/kernel/code-files.ts): a code field's value is stored as
// its files, each by its hash, with the text of a file only where the field's last value lacked it, and read back
// whole by every reader; a value stored before this reads as it did.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { Fact } from '../packs/log/kernel/log.ts';
import { codeFacts, hashesOf, isCodeStored } from '../packs/seal/kernel/code-files.ts';
import { openRows } from '../packs/seal/kernel/seal.ts';
import { codeFields } from '../packs/loader/kernel/pack-code.ts';
import { all, fresh, human, make } from './map.ts';

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const CODE = new Map([['code', 'index.js'], ['modules', 'index.js'], ['page_css', 'index.css']]);
const none = () => new Set<string>();

test('a code field is stored as files by hash, with only the texts the field lacks', () => {
  const a = 'export const a = 1;\n', b = 'export const b = 2;\n';
  const facts: Fact[] = [['+', 'e_1', 'modules', { 'index.js': a, 'b.js': b }], ['+', 'e_1', 'title', 'Rows'], ['+', 'e_2', 'code', a], ['-', 'e_3', 'code']];
  const [m, title, one, gone] = codeFacts(facts, CODE, (id) => (id === 'e_1' ? new Set([sha(a)]) : none()));
  assert.deepEqual(m[3], { $files: { 'index.js': sha(a), 'b.js': sha(b) }, $texts: { [sha(b)]: b } }, 'the text the field had is named by its hash alone');
  assert.deepEqual(one[3], { $files: { 'index.js': sha(a) }, $texts: { [sha(a)]: a }, $one: true }, 'one text is one file');
  assert.deepEqual(title, facts[1], 'a field that is not code is as it was');
  assert.deepEqual(gone, facts[3]);
  assert.ok(isCodeStored(m[3]) && !isCodeStored({ 'index.js': a }));
  assert.deepEqual([...hashesOf(m[3])], [...hashesOf({ 'index.js': a, 'b.js': b })], 'a value has the same hashes in either form');
  // Within one entry a text goes in once, and a value of another shape stays as it was.
  const twice = codeFacts([['+', 'e_1', 'code', a], ['+', 'e_1', 'code', a], ['+', 'e_1', 'modules', { 'x.js': 3 }]], CODE, none);
  assert.deepEqual(twice[1][3], { $files: { 'index.js': sha(a) }, $one: true });
  assert.deepEqual(twice[2][3], { 'x.js': 3 });
});

test('a one-line edit of one module logs that module\'s text alone, and every reader reads the whole', async () => {
  const l = await fresh();
  const big = `export const rows = [\n${Array.from({ length: 2000 }, (_, i) => `  ${i},`).join('\n')}\n];\n`;
  const modules = { 'index.js': 'export const picture = () => [];\n', 'rows.js': big };
  const { m } = await make(l, [{ op: 'create', ref: 'm', type: 'layout', title: 'Rows', props: { preset: 'lists.rows', modules } }]);
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: m, edit: { field: 'modules', file: 'index.js', find: '[]', with: '[1]' } }] });
  const now = { ...modules, 'index.js': 'export const picture = () => [1];\n' };
  const { rows } = await l.db.query<{ id: string; field: string; value: unknown }>(`select id, field, value from log_fact where id = $1 and field = 'modules' order by pos`, [m]);
  const stored = (await openRows(l.db, rows)).map((r) => r.value as { $files: Record<string, string>; $texts?: Record<string, string> });
  assert.equal(stored.length, 2);
  assert.deepEqual(Object.keys(stored[0].$texts!).sort(), [sha(modules['index.js']), sha(big)].sort(), 'made: each file\'s text once');
  assert.deepEqual(stored[1].$texts, { [sha(now['index.js'])]: now['index.js'] }, 'edited: the changed file\'s text alone');
  assert.equal(stored[1].$files['rows.js'], sha(big));
  assert.ok(JSON.stringify(stored[1]).length < 300, 'the edit\'s fact is small beside a 15 KB module');
  assert.deepEqual((await l.entity(m))!.props.modules, now, 'the projection reads the whole');
  const read = (await all(l)).flatMap((e) => e.facts).filter((f) => f[1] === m && f[2] === 'modules').map((f) => f[3]);
  assert.deepEqual(read, [modules, now], 'the log read back gives each value whole');
});

test('a one-text code field reads back as its text, and a value from before as it was', async () => {
  const l = await fresh();
  const CODE1 = 'export default function draw() {}\n';
  const { s } = await make(l, [{ op: 'create', ref: 's', type: 'layout', title: 'Field', props: { code: CODE1 } }]);
  assert.equal((await l.entity(s))!.props.code, CODE1);
  const [f] = (await all(l)).flatMap((e) => e.facts).filter((x) => x[1] === s && x[2] === 'code');
  assert.equal(f[3], CODE1);
  // The same field back to a text it had before: named by its hash alone where it is the field's last, else kept again.
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: s, props: { code: 'x' } }] });
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: s, props: { code: CODE1 } }] });
  assert.equal((await l.entity(s))!.props.code, CODE1);
  assert.deepEqual((await all(l)).flatMap((e) => e.facts).filter((x) => x[1] === s && x[2] === 'code').map((x) => x[3]), [CODE1, 'x', CODE1]);
  assert.equal(codeFields(l.registry).get('page_css'), 'index.css', 'a stylesheet is a .css file');
});

test('a value stored whole before this is where a later value finds the texts it names by hash', async () => {
  const l = await fresh();
  const modules = { 'index.js': 'export const picture = () => [];\n', 'rows.js': 'export const n = 1;\n' };
  const { m } = await make(l, [{ op: 'create', ref: 'm', type: 'layout', title: 'Rows', props: { preset: 'lists.rows' } }]);
  // As a log written before this holds it: the whole value, appended with no code fields named.
  const { append } = await import('../packs/log/kernel/log.ts');
  await l.db.transaction((tx) => append(tx, l.workspace, 'facts', { id: `c_${Date.now().toString(36)}`, actor: { id: 'system' }, authority: null, rule: { outcome: 'apply', spared: [] }, reason: 'as before', source: null, action: null, undoes: null, keys: [] }, [['+', m, 'modules', modules]]));
  const now = { ...modules, 'index.js': 'export const picture = () => [1];\n' };
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: m, props: { modules: now } }] });
  const { rows } = await l.db.query<{ id: string; field: string; value: unknown }>(`select id, field, value from log_fact where id = $1 and field = 'modules' order by pos`, [m]);
  const stored = (await openRows(l.db, rows)).map((r) => r.value);
  assert.deepEqual(stored[0], modules, 'the old value is as it was stored');
  assert.deepEqual((stored[1] as { $texts: object }).$texts, { [sha(now['index.js'])]: now['index.js'] }, 'the text the old value had is not kept again');
  assert.deepEqual((await all(l)).flatMap((e) => e.facts).filter((f) => f[1] === m && f[2] === 'modules').map((f) => f[3]), [modules, now]);
});
