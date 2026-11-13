// A view's drawing sends its pack's actions (packs/loader/kernel/view-calls.ts, decision e_k9qu6s4g): the view a pack
// ships names them in its style (`sends`, by gesture), the page calls one as the person with `part: { view, hash }`,
// and the change names the view and the drawing's code. Refused from an agent, at code no drawing here has, for an
// action the view does not send, from a view no pack ships, and for one a person calls alone. The page's side is
// drawingActs in packs/walls/page/layout-asks.js.

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { entry } from '../packs/log/kernel/log.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { packLayout } from '../packs/loader/kernel/layouts.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

const input = { type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false };
/** A map pack with a drawing, a view on it that sends one action, an action it does not send, and one only a person may call. */
const shelf = {
  id: 'shelf', version: '1.0.0', title: 'Shelf', description: 'A view that sends.', requires: ['core'],
  actions: [
    { id: 'shelf.put', title: 'Put', description: 'Put it.', verb: 'capture', input },
    { id: 'shelf.other', title: 'Other', description: 'Not the view’s.', verb: 'capture', input },
    { id: 'shelf.mine', title: 'Mine', description: 'A person’s alone.', verb: 'capture', input, humanOnly: true },
  ],
  layouts: [{ id: 'shelf.grid', title: 'Grid', shape: 'shelfgrid', modules: { 'index.js': 'draw/index.js' } }],
  styles: [{ id: 'shelf.view', type: 'lens', title: 'Shelf', props: { filter: { find: ['type task'] }, walk: { over: [], steps: 0 }, style: { shape: 'shelfgrid', sends: { add: 'shelf.put', mine: 'shelf.mine' } } } }],
};

const HANDLER = `const put = (input) => ({ ops: [{ op: 'create', type: 'task', title: input.title ?? 'Put' }], reason: 'Put from the view' });
export default { 'shelf.put': put, 'shelf.other': put, 'shelf.mine': put };
`;

function folder(): string {
  const dir = packsWith(shelf as unknown as PackFile);
  writeFileSync(join(dir, 'shelf', 'handler.js'), HANDLER);
  mkdirSync(join(dir, 'shelf', 'draw'), { recursive: true });
  writeFileSync(join(dir, 'shelf', 'draw', 'index.js'), "export function picture() { return { scene: { message: 'shelf' } }; }\n");
  return dir;
}

test('a view’s action goes out as the person’s, its change naming the view and its drawing', async () => {
  const dir = folder();
  const l = await freshWith(new Registry(dir));
  try {
    const hash = packLayout(l.registry, 'shelf.grid')!.hash;
    const done = (await callTool(l, human, 'shelf_put', { title: 'From the view', part: { view: 'shelf.view', hash } })) as { status: string; changeset: string };
    assert.equal(done.status, 'applied');
    const logged = (await entry(l.db, done.changeset)) as unknown as { part?: unknown; action?: string; actor: { id: string } };
    assert.deepEqual(logged.part, { id: 'shelf.view', hash }, 'the log names the view and the drawing’s code');
    assert.equal(logged.action, 'shelf.put');
    assert.match(logged.actor.id, /^human:/);
    // A view kept on the map is the owner's version of the pack's: it sends what the pack's sends, by its preset.
    const kept = await make(l, [{ op: 'create', ref: 'v', type: 'lens', title: 'My shelf', props: { preset: 'shelf.view', filter: { find: ['type task'] }, style: { shape: 'shelfgrid', sends: { add: 'shelf.other' } } } }]);
    const id = kept.v;
    assert.equal(((await callTool(l, human, 'shelf_put', { part: { view: id, hash } })) as { status: string }).status, 'applied');
    // What the map's copy names is not what the pack ships: no change on the map widens what a view sends.
    await assert.rejects(callTool(l, human, 'shelf_other', { part: { view: id, hash } }), /does not send "shelf.other"/);
  } finally {
    hostFor(l.registry).stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a view’s call is refused: from an agent, at code not drawn, an action it does not send, a view no pack ships, one a person calls alone', async () => {
  const dir = folder();
  const l = await freshWith(new Registry(dir));
  try {
    const hash = packLayout(l.registry, 'shelf.grid')!.hash;
    const part = { view: 'shelf.view', hash };
    await assert.rejects(callTool(l, agent, 'shelf_put', { part }), /sent by the page, as the person looking/);
    await assert.rejects(callTool(l, human, 'shelf_put', { part: { view: 'shelf.view', hash: 'f'.repeat(64) } }), /no drawing with that code is drawn here/);
    await assert.rejects(callTool(l, human, 'shelf_other', { part }), /does not send "shelf.other"/);
    await assert.rejects(callTool(l, human, 'shelf_put', { part: { view: 'shelf.gone', hash } }), /no view "shelf.gone"/);
    await assert.rejects(callTool(l, human, 'shelf_mine', { part }), /one a person chooses to call themselves/);
  } finally {
    hostFor(l.registry).stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
