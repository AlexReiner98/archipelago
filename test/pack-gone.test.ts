// A pack whose folder is gone: what a self-hosted workspace meets when it updates past the packs that moved to the
// hosted service (decision e_8jd82drh, 9 Nov 2026). Its items stay, dormant; the log is not told the pack was taken
// out; and the same pack found again, in another folder, is the same pack.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { Archipelago } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { syncTypes } from '../src/typetable.ts';
import { callTool } from '../src/tools.ts';
import { agent, human, PACKS } from './map.ts';

const packFacts = async (l: Archipelago) =>
  (await l.db.query<{ id: string; op: string }>(`select id, op from log_fact where stream = 'facts' and field = 'pack' order by pos, n`)).rows.map((r) => `${r.op}${r.id}`);

test('a pack whose folder is gone leaves its items dormant, and found in another folder it is the same pack', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pelago-pack-gone-'));
  try {
    const open = join(root, 'open'), hosted = join(root, 'hosted');
    for (const id of ['core', 'work']) cpSync(join(PACKS, id), join(open, id), { recursive: true });
    cpSync(join(PACKS, 'funding'), join(hosted, 'funding'), { recursive: true });
    const db = await openDb();
    const both = new Archipelago(db, new Registry([open, hosted]));
    await syncTypes(both);
    await callTool(both, { ...human, admin: true }, 'pack_set', { pack: 'funding', on: true });
    const { created } = (await both.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'g', type: 'program', title: 'Seed grant', status: 'open' }] })) as { created: Record<string, string> };
    const before = await packFacts(both);
    assert.ok(before.includes('+pack:funding'), 'the workspace has the pack');

    // Updated to a server that has only the open folder.
    const alone = new Archipelago(db, new Registry([open]));
    const synced = await syncTypes(alone);
    assert.ok(synced.dormant.includes('program'), 'its type is dormant');
    assert.equal((await alone.entity(created.g))?.title, 'Seed grant', 'the item is still there');
    assert.equal((await alone.change(human, { reason: 'test', ops: [{ op: 'update', id: created.g, title: 'Seed grant 2027' }] })).status, 'applied', 'a person still edits it');
    assert.equal((await alone.change(agent, { reason: 'test', ops: [{ op: 'update', id: created.g, title: 'Seed grant 2028' }] })).status, 'proposed', "an agent's edit waits");
    assert.deepEqual(await packFacts(alone), before, 'the log is not told the pack was taken out');

    // The pack found again, now in the hosted folder only: active, with nothing new said of it.
    const back = new Archipelago(db, new Registry([open, hosted]));
    const again = await syncTypes(back);
    assert.ok(again.activated.includes('program'));
    assert.equal(back.registry.type('program')?.dormant, undefined);
    assert.deepEqual(await packFacts(back), before, 'the same pack, by its id');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
