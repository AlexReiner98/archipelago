// An admin's action from a part goes only on an admin's own press (decision e_ssrawn4v; packs/loader/kernel/press-grants.ts,
// part-calls.ts): the page asks press_grant the moment the person presses, and the one action after carries the grant,
// taken once. An admin's press works; a non-admin's, a send with no press, a grant used again, one for another part or
// person or run out, and an agent's call are refused. The page's side, in a browser, is test/press-grants-page.test.ts.

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { GRANT_LASTS, mintGrant, takeGrant } from '../packs/loader/kernel/press-grants.ts';
import { partsFor } from '../packs/loader/kernel/ui-parts.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import type { Actor } from '../packs/write/kernel/pelago.ts';
import { agent, freshWith, human, packsWith } from './map.ts';

const admin: Actor = { ...human, admin: true };
const other: Actor = { kind: 'human', name: 'someone else', admin: true };

const input = { type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false };
/** A pack whose part sends an admin's action, and another whose part sends none. */
const desk = {
  id: 'desk', version: '1.0.0', title: 'Desk', description: 'An admin’s part.', requires: ['core'],
  actions: [
    { id: 'desk.boss', title: 'Boss', description: 'An admin’s.', verb: 'capture', input, admin: true },
    { id: 'desk.put', title: 'Put', description: 'Anyone’s.', verb: 'capture', input },
  ],
  parts: [
    { id: 'desk.row', title: 'Row', slot: 'sheet', marks: ['box', 'text', 'button'], sends: ['desk.boss', 'desk.put'], modules: { 'index.js': 'parts/row/index.js' } },
    { id: 'desk.plain', title: 'Plain', slot: 'sheet', marks: ['text'], sends: ['desk.put'], modules: { 'index.js': 'parts/row/index.js' } },
  ],
};
const HANDLER = `const put = (input) => ({ ops: [{ op: 'create', type: 'task', title: input.title ?? 'Put' }], reason: 'Put on the desk' });
export default { 'desk.boss': put, 'desk.put': put };
`;

async function deskMap() {
  const dir = packsWith(desk as unknown as PackFile);
  writeFileSync(join(dir, 'desk', 'handler.js'), HANDLER);
  mkdirSync(join(dir, 'desk', 'parts', 'row'), { recursive: true });
  writeFileSync(join(dir, 'desk', 'parts', 'row', 'index.js'), "export default () => ({ marks: ['text', {}, 'row'] });\n");
  const l = await freshWith(new Registry(dir));
  const parts = partsFor(l.registry).filter((p) => p.pack === 'desk');
  const ref = (id: string) => { const p = parts.find((x) => x.id === id)!; return { id: p.id, hash: p.hash }; };
  const done = () => (hostFor(l.registry).stop(), rmSync(dir, { recursive: true, force: true }));
  return { l, parts, row: ref('desk.row'), plain: ref('desk.plain'), done };
}

const grantFor = async (l: Parameters<typeof callTool>[0], actor: Actor, part: object) => ((await callTool(l, actor, 'press_grant', { part })) as { grant: string }).grant;
const tasks = async (l: Parameters<typeof callTool>[0]) => (await l.db.query<{ n: number }>(`select count(*)::int as n from entity where type = 'task'`)).rows[0].n;

test('a part is told which of its actions are an admin’s', async () => {
  const { parts, done } = await deskMap();
  try {
    assert.deepEqual(parts.find((p) => p.id === 'desk.row')?.admin, ['desk.boss']);
    assert.equal(parts.find((p) => p.id === 'desk.plain')?.admin, undefined);
  } finally {
    done();
  }
});

test('an admin’s press carries the admin’s action, once', async () => {
  const { l, row, done } = await deskMap();
  try {
    const grant = await grantFor(l, admin, row);
    const made = (await callTool(l, admin, 'desk_boss', { title: 'On the press', part: { ...row, grant } })) as { status: string };
    assert.equal(made.status, 'applied');
    assert.equal(await tasks(l), 1);
    // The same grant again is a replay: refused, and nothing more is made.
    await assert.rejects(callTool(l, admin, 'desk_boss', { title: 'Again', part: { ...row, grant } }), /sent only on an admin's own press/);
    assert.equal(await tasks(l), 1);
  } finally {
    done();
  }
});

test('a non-admin’s press carries nothing', async () => {
  const { l, row, done } = await deskMap();
  try {
    await assert.rejects(grantFor(l, human, row), /only a workspace admin’s press/);
    // A grant an admin's press minted is the admin's: another person cannot spend it, nor one no longer an admin.
    const grant = await grantFor(l, admin, row);
    await assert.rejects(callTool(l, human, 'desk_boss', { part: { ...row, grant } }), /sent only on an admin's own press/);
    await assert.rejects(callTool(l, other, 'desk_boss', { part: { ...row, grant: await grantFor(l, admin, row) } }), /sent only on an admin's own press/);
    assert.equal(await tasks(l), 0);
  } finally {
    done();
  }
});

test('a part sending an admin’s action with no press is refused', async () => {
  const { l, row, plain, done } = await deskMap();
  try {
    await assert.rejects(callTool(l, admin, 'desk_boss', { part: row }), /sent only on an admin's own press/);
    await assert.rejects(callTool(l, admin, 'desk_boss', { part: { ...row, grant: 'made-up' } }), /sent only on an admin's own press/);
    // A grant for one part is not another's, and a part that sends no admin's action gets none.
    await assert.rejects(grantFor(l, admin, plain), /sends no admin's action/);
    await assert.rejects(grantFor(l, admin, { id: row.id, hash: 'f'.repeat(64) }), /no part "desk.row" with that code/);
    // What a part may send without one still goes, and the admin's own call (no part) is theirs, as before.
    assert.equal(((await callTool(l, admin, 'desk_put', { part: row })) as { status: string }).status, 'applied');
    assert.equal(((await callTool(l, admin, 'desk_boss', { title: 'By hand' })) as { status: string }).status, 'applied');
  } finally {
    done();
  }
});

test('an agent can neither mint a grant nor spend one', async () => {
  const { l, row, done } = await deskMap();
  try {
    await assert.rejects(grantFor(l, agent, row), /for humans only/);
    await assert.rejects(grantFor(l, { ...agent, admin: true }, row), /for humans only/);
    const grant = await grantFor(l, admin, row);
    await assert.rejects(callTool(l, agent, 'desk_boss', { part: { ...row, grant } }), /sent by the page, as the person looking/);
    await assert.rejects(callTool(l, { ...agent, admin: true }, 'desk_boss', { title: 'x' }), /admins only/);
    assert.equal(await tasks(l), 0);
  } finally {
    done();
  }
});

test('a grant is the one person’s, for the one part, for a few seconds, once', () => {
  const part = { id: 'desk.row', hash: 'a'.repeat(64) };
  assert.throws(() => mintGrant('default', human, part), /admin/);
  assert.throws(() => mintGrant('default', { ...agent, admin: true }, part), /person/);
  const at = 1_000_000;
  const g = () => mintGrant('default', admin, part, at);
  assert.equal(takeGrant(g(), 'default', admin, part, at + GRANT_LASTS + 1), false, 'run out');
  assert.equal(takeGrant(g(), 'other', admin, part, at), false, 'another workspace');
  assert.equal(takeGrant(g(), 'default', other, part, at), false, 'another person');
  assert.equal(takeGrant(g(), 'default', admin, { ...part, hash: 'b'.repeat(64) }, at), false, 'other code');
  const once = g();
  assert.equal(takeGrant(once, 'default', admin, part, at + 5), true);
  assert.equal(takeGrant(once, 'default', admin, part, at + 6), false, 'taken already');
  assert.equal(takeGrant(undefined, 'default', admin, part, at), false);
});
