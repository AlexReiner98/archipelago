// An edit of a code field (task e_rvrbymwn): one passage of a layout's code or a module of its modules replaced, as an
// agent's text editor does, refused in the agent's words when it cannot be, and logged as an ordinary update of the
// whole field, judged by the same rules as one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Actor } from '../packs/write/kernel/pelago.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { editAfter, textHash } from '../packs/write/kernel/edit.ts';
import { all, fresh, human, make } from './map.ts';

const owner: Actor = { kind: 'human', name: 'owner', admin: true };
const agent: Actor = { kind: 'agent', name: 'test' };
const CODE = 'export default function draw({ canvas }) {\n  const ctx = canvas.getContext("2d");\n  ctx.fillStyle = "red";\n  ctx.fillRect(0, 0, 10, 10);\n}\n';
const refused = async (p: Promise<unknown>, said: RegExp) => assert.match(await p.then(() => 'applied', (e: Error) => e.message), said);

test('editAfter replaces the one passage, and says why it cannot', () => {
  assert.equal(editAfter('a b c', { field: 'code', find: 'b', with: 'B' }, 'code'), 'a B c');
  assert.equal(editAfter('a $& c', { field: 'code', find: '$&', with: '$1' }, 'code'), 'a $1 c', 'with is taken as it is, no patterns');
  assert.throws(() => editAfter('a b c', { field: 'code', find: 'x', with: 'y' }, 'code'), /exactly once, and is there not at all/);
  assert.throws(() => editAfter('b b', { field: 'code', find: 'b', with: 'y' }, 'code'), /is there 2 times/);
  assert.throws(() => editAfter('a b', { field: 'code', find: 'b', with: 'y', base: textHash('a c') }, 'code'), /base moved/);
  assert.equal(editAfter('a b', { field: 'code', find: 'b', with: 'y', base: `sha256:${textHash('a b').toUpperCase()}` }, 'code'), 'a y');
});

test('an edit of a layout\'s code is an ordinary update of the whole field in the log', async () => {
  const l = await fresh();
  const { s } = await make(l, [{ op: 'create', ref: 's', type: 'layout', title: 'Field', props: { code: CODE } }]);
  const done = (await l.change(human, { reason: 'test', ops: [{ op: 'update', id: s, edit: { field: 'code', find: '"red"', with: '"blue"', base: textHash(CODE) } }] })) as { status: string; edited: { id: string; field: string; base: string }[] };
  const now = CODE.replace('"red"', '"blue"');
  assert.equal(done.status, 'applied');
  assert.equal((await l.entity(s))!.props.code, now);
  assert.deepEqual(done.edited, [{ id: s, field: 'code', base: textHash(now) }], 'the answer gives the hash to edit from next');
  const last = (await all(l)).at(-1)!;
  assert.deepEqual(last.facts.filter((f) => f[1] === s && f[2] === 'code').map((f) => f[3]), [now], 'the log holds the whole field, as any update of it');
  // The next edit from the hash it was given goes; one from the old hash is refused: someone moved it.
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: s, edit: { field: 'code', find: '10, 10', with: '20, 20', base: done.edited[0].base } }] });
  await refused(l.change(human, { reason: 'test', ops: [{ op: 'update', id: s, edit: { field: 'code', find: '"blue"', with: '"green"', base: textHash(CODE) } }] }), /op 1 \(update\): edit\.base moved: code of "Field" has changed since it was read/);
});

test('an edit is refused in the agent\'s terms: not found, found more than once, not a code field, not a module', async () => {
  const l = await fresh();
  const { s, m, t } = await make(l, [
    { op: 'create', ref: 's', type: 'layout', title: 'Field', props: { code: CODE } },
    { op: 'create', ref: 'm', type: 'layout', title: 'Rows', props: { preset: 'lists.rows', modules: { 'index.js': 'export const picture = () => [1, 1];\n', 'rows.js': 'export const n = 1;\n' } } },
    { op: 'create', ref: 't', type: 'task', title: 'A task' },
  ]);
  const edit = (id: string, e: Record<string, unknown>, extra: Record<string, unknown> = {}) => l.change(human, { reason: 'test', ops: [{ op: 'update', id, edit: e, ...extra } as never] });
  await refused(edit(s, { field: 'code', find: '"green"', with: 'x' }), /edit\.find must be in code of "Field" exactly once, and is there not at all/);
  await refused(edit(s, { field: 'code', find: 'ctx', with: 'c' }), /is there 3 times/);
  await refused(edit(t, { field: 'title', find: 'A', with: 'B' }), /edit\.field "title" is not a code field of a task/);
  await refused(edit(s, { field: 'code', find: 'red', with: 'blue' }, { props: { code: 'x' } }), /props\.code \(the whole field\) or edit/);
  await refused(edit(m, { field: 'modules', find: '1', with: '2' }), /holds modules by name: say which in edit\.file \(index\.js, rows\.js\)/);
  await refused(edit(m, { field: 'modules', file: 'nope.js', find: '1', with: '2' }), /no module "nope\.js": it has index\.js, rows\.js/);
  await refused(edit(s, { field: 'code', file: 'index.js', find: 'red', with: 'blue' }), /one text, not modules by name/);
  await refused(edit(m, { field: 'modules', file: 'index.js', find: '1', with: '2' }), /index\.js of "Rows" exactly once, and is there 2 times/);
  // A module by name: only that module changes, and the others stay as they were.
  await edit(m, { field: 'modules', file: 'rows.js', find: 'n = 1', with: 'n = 2' });
  assert.deepEqual((await l.entity(m))!.props.modules, { 'index.js': 'export const picture = () => [1, 1];\n', 'rows.js': 'export const n = 2;\n' });
  assert.equal((await l.entity(s))!.props.code, CODE, 'nothing a refused edit named moved');
});

test('two edits of one field in one change each see the text the one before left', async () => {
  const l = await fresh();
  const { s } = await make(l, [{ op: 'create', ref: 's', type: 'layout', title: 'Field', props: { code: CODE } }]);
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: s, edit: { field: 'code', find: '"red"', with: '"blue"' } }, { op: 'update', id: s, edit: { field: 'code', find: '"blue"', with: '"teal"' } }] });
  assert.equal((await l.entity(s))!.props.code, CODE.replace('"red"', '"teal"'));
});

test('an agent\'s edit of code waits under code_runs, holds the whole field, and applies it when approved', async () => {
  const l = await fresh();
  const { s } = await make(l, [{ op: 'create', ref: 's', type: 'layout', title: 'Field', props: { code: CODE } }]);
  await callTool(l, owner, 'workspace_set', { agent_changes: 'apply' });
  const held = (await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'update', id: s, edit: { field: 'code', find: '"red"', with: '"blue"' } }] })) as { status: string; proposal: string; held_by: { rule: string } };
  assert.deepEqual([held.status, held.held_by.rule], ['proposed', 'code_runs']);
  assert.equal((await l.entity(s))!.props.code, CODE, 'nothing has changed yet');
  const { rows } = await l.db.query<{ ops: { props?: { code?: string }; edit?: unknown }[] }>(`select ops from proposal where id = $1`, [held.proposal]);
  assert.equal(rows[0].ops[0].edit, undefined, 'the held change holds the whole field, not the edit');
  assert.equal(rows[0].ops[0].props?.code, CODE.replace('"red"', '"blue"'));
  await l.decide(owner, { proposal: held.proposal, approve: true } as never);
  assert.equal((await l.entity(s))!.props.code, CODE.replace('"red"', '"blue"'));
  // Where the owner lets agents change code, it applies as made, and says what let it through.
  await callTool(l, owner, 'workspace_set', { agent_code: true });
  const made = (await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'update', id: s, edit: { field: 'code', find: '"blue"', with: '"teal"' } }] })) as { status: string; let_through?: { rule: string }[] };
  assert.equal(made.status, 'applied');
  assert.ok(made.let_through?.some((r) => r.rule === 'code_runs'));
});
