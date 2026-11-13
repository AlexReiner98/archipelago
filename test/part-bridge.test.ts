// The bridge, on the server's side (packs/loader/kernel/part-calls.ts, task e_9ests3je): a part's action is sent as the
// person looking, names the part and the hash of its code on its change, and is refused when the call is an agent's,
// the part is not drawn at that code, the action is not one it sends, or the action is one a person chooses alone. A
// part that asks to send such an action does not load. The page's side is test/part-bridge-page.test.ts.

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { entry } from '../packs/log/kernel/log.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { partsFor } from '../packs/loader/kernel/ui-parts.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

/** The test pack's own parts: the repository's packs ship parts beside them (findings's). */
const shelfs = <T extends { pack: string }>(parts: T[]) => parts.filter((p) => p.pack === 'shelf');

const input = { type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false };
/** A map pack with an action its part sends, one it does not, and one only a person may call. */
const shelf = (sends = ['shelf.put']) => ({
  id: 'shelf', version: '1.0.0', title: 'Shelf', description: 'A part of the page.', requires: ['core'],
  actions: [
    { id: 'shelf.put', title: 'Put', description: 'Put it.', verb: 'capture', input },
    { id: 'shelf.other', title: 'Other', description: 'Not the part’s.', verb: 'capture', input },
    { id: 'shelf.mine', title: 'Mine', description: 'A person’s alone.', verb: 'capture', input, humanOnly: true },
  ],
  parts: [{ id: 'shelf.row', title: 'Row', slot: 'sheet', sends, modules: { 'index.js': 'parts/row/index.js' } }],
});

const HANDLER = `const put = (input) => ({ ops: [{ op: 'create', type: 'task', title: input.title ?? 'Put' }], reason: 'Put on the shelf' });
export default { 'shelf.put': put, 'shelf.other': put, 'shelf.mine': put };
`;

function folder(pack: Record<string, unknown>): string {
  const dir = packsWith(pack as unknown as PackFile);
  writeFileSync(join(dir, 'shelf', 'handler.js'), HANDLER);
  mkdirSync(join(dir, 'shelf', 'parts', 'row'), { recursive: true });
  writeFileSync(join(dir, 'shelf', 'parts', 'row', 'index.js'), "export default () => ({ marks: ['text', {}, 'row'] });\n");
  return dir;
}

test('a part’s action goes out as the person’s, its change naming the part and its code', async () => {
  const dir = folder(shelf());
  const l = await freshWith(new Registry(dir));
  try {
    const [row] = shelfs(partsFor(l.registry));
    const part = { id: row.id, hash: row.hash };
    const done = (await callTool(l, human, 'shelf_put', { title: 'From the row', part })) as { status: string; changeset: string; created: Record<string, string> };
    assert.equal(done.status, 'applied');
    const logged = (await entry(l.db, done.changeset)) as unknown as { part?: unknown; action?: string; actor: { id: string } };
    assert.deepEqual(logged.part, part, 'the log names the part and its hash');
    assert.equal(logged.action, 'shelf.put');
    assert.match(logged.actor.id, /^human:/, 'on the person’s authority');
    // Without a part, the action is the person's own, as before.
    const plain = (await callTool(l, human, 'shelf_put', { title: 'By hand' })) as { changeset: string };
    assert.equal(((await entry(l.db, plain.changeset)) as unknown as { part?: unknown }).part, undefined);

    // The owner's open version of the part is drawn too: its code's hash is let through.
    const mine = { is_open: true, props: { preset: 'shelf.row', code: { 'index.js': "export default () => ({ marks: ['text', {}, 'mine'] });\n" } } };
    await make(l, [{ op: 'create', type: 'part', title: 'Row, mine', props: { ...mine.props, pack: 'shelf', slot: 'sheet' } }]);
    const theirs = shelfs(partsFor(l.registry, [mine]))[0];
    assert.notEqual(theirs.hash, row.hash);
    assert.equal(((await callTool(l, human, 'shelf_put', { part: { id: row.id, hash: theirs.hash } })) as { status: string }).status, 'applied');
  } finally {
    hostFor(l.registry).stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a part’s call is refused: from an agent, at code not drawn, an action it does not send, one a person calls alone', async () => {
  const dir = folder(shelf());
  const l = await freshWith(new Registry(dir));
  try {
    const [row] = shelfs(partsFor(l.registry));
    const part = { id: row.id, hash: row.hash };
    await assert.rejects(callTool(l, agent, 'shelf_put', { part }), /sent by the page, as the person looking/);
    await assert.rejects(callTool(l, human, 'shelf_put', { part: { id: row.id, hash: 'f'.repeat(64) } }), /no part "shelf.row" with that code is drawn here/);
    await assert.rejects(callTool(l, human, 'shelf_put', { part: { id: 'shelf.gone', hash: row.hash } }), /no part "shelf.gone"/);
    await assert.rejects(callTool(l, human, 'shelf_put', { part: 'shelf.row' }), /part is \{ id, hash \}/);
    await assert.rejects(callTool(l, human, 'shelf_other', { part }), /shelf.row does not send "shelf.other"/);
    await assert.rejects(callTool(l, human, 'shelf_mine', { part }), /does not send "shelf.mine"/);
    // A kernel act is no pack's action: naming a part on it is refused as such, never run.
    await assert.rejects(callTool(l, human, 'change', { ops: [{ op: 'create', type: 'task', title: 'x' }], reason: 'x', part }), /part/);
    assert.equal((await l.db.query<{ n: number }>(`select count(*)::int as n from entity where type = 'task'`)).rows[0].n, 0, 'nothing was made');
  } finally {
    hostFor(l.registry).stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a part that would send an action only a person may call does not load', () => {
  const dir = folder(shelf(['shelf.put', 'shelf.mine']));
  try {
    // Its pack waits with why, and the map loads without it (e_6g34wqdm).
    const state = new Registry(dir).states.get('shelf');
    assert.equal(state?.state, 'waiting');
    assert.match(state?.why ?? '', /sends "shelf.mine", which only a person or an admin may call: a part never sends it/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
