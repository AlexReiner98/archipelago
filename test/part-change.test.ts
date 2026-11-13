// A change a root pack's part makes as the person looking (packs/loader/kernel/part-calls.ts partChange, the sheet's
// tools.change): it goes through the one write path as that person's, naming the part and its code, and is refused when
// it is an agent's, the part is not drawn at that code, it touches a type the part does not write, or it would merge,
// define a type or forget. Only a root pack's part may declare `writes`.

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

/** A pack whose one part writes tasks: a root pack's, or (`trust` left out) a map pack's. */
const desk = (trust?: string) => ({
  id: 'desk', version: '1.0.0', title: 'Desk', description: 'A part that writes.', requires: ['core'],
  ...(trust && { kernel: { trust, internal: true } }),
  parts: [{ id: 'desk.page', title: 'Page', slot: 'sheet', reads: '*', writes: ['task'], marks: ['box'], modules: { 'index.js': 'parts/page/index.js' } }],
});

function folder(pack: Record<string, unknown>): string {
  const dir = packsWith(pack as unknown as PackFile);
  mkdirSync(join(dir, 'desk', 'parts', 'page'), { recursive: true });
  writeFileSync(join(dir, 'desk', 'parts', 'page', 'index.js'), "export default () => ({ marks: ['box'] });\n");
  return dir;
}

test("a root pack's part changes what it writes as the person, its change naming the part", async () => {
  const dir = folder(desk('root'));
  const l = await freshWith(new Registry(dir));
  try {
    const page = partsFor(l.registry).find((p) => p.id === 'desk.page')!;
    assert.deepEqual(page.writes, ['task']);
    const part = { id: page.id, hash: page.hash };
    const change = (ops: unknown[], who = human, as = part) => callTool(l, who, 'change', { ops, reason: 'From the page', part: as }) as Promise<{ status: string; changeset: string; created: Record<string, string> }>;

    const made = await change([{ op: 'create', ref: 't', type: 'task', title: 'Written by the page' }]);
    assert.equal(made.status, 'applied');
    const logged = (await entry(l.db, made.changeset)) as unknown as { part?: unknown; actor: { id: string } };
    assert.deepEqual(logged.part, part, 'the log names the part and its hash');
    assert.match(logged.actor.id, /^human:/, 'on the person’s authority');
    const id = made.created.t;
    assert.equal((await change([{ op: 'update', id, title: 'Renamed' }])).status, 'applied');

    // What it does not write, what no part may do, an agent's call, and code not drawn here are refused.
    const { d } = await make(l, [{ op: 'create', ref: 'd', type: 'decision', title: 'Not the page’s' }]);
    await assert.rejects(change([{ op: 'create', type: 'decision', title: 'No' }]), /makes a "decision", which desk.page does not write/);
    await assert.rejects(change([{ op: 'update', id: d, title: 'No' }]), /changes an item desk.page does not write/);
    await assert.rejects(change([{ op: 'forget', id }]), /a part may create, update, link, unlink, archive, restore; not forget/);
    await assert.rejects(change([{ op: 'update', id, title: 'No' }], agent), /sent by the page, as the person looking/);
    await assert.rejects(change([{ op: 'update', id, title: 'No' }], human, { id: page.id, hash: 'a'.repeat(64) }), /no part "desk.page" with that code is drawn here/);
  } finally {
    hostFor(l.registry).stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a map pack's part may not declare what it writes: it sends its pack's actions", () => {
  const dir = folder(desk());
  try {
    const state = new Registry(dir).states.get('desk');
    assert.notEqual(state?.state, 'active');
    assert.match(state?.why ?? '', /writes items, which only a root pack's part may/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
