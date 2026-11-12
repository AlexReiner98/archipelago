// A pack whose folder is gone: what a self-hosted workspace meets when it updates past the packs that moved to the
// hosted service (decision e_8jd82drh, 9 Nov 2026). Its items stay, dormant; the log is not told the pack was taken
// out; and the same pack found again, in another folder, is the same pack.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../packs/database/kernel/db.ts';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { syncTypes } from '../packs/loader/kernel/typetable.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, human, PACKS } from './map.ts';

/** A pack written for the test, as the hosted folder would hold one. */
const GRANTS = { id: 'grants', version: '1', title: 'Grants', description: 'A pack kept in a folder of its own.', requires: ['core'], types: [{ id: 'grant', title: 'Grant', description: 'A grant applied for.', extends: 'record' }] };

const packFacts = async (l: Archipelago) =>
  (await l.db.query<{ id: string; op: string }>(`select id, op from log_fact where stream = 'facts' and field = 'pack' order by pos, n`)).rows.map((r) => `${r.op}${r.id}`);

test('a pack whose folder is gone leaves its items dormant, and found in another folder it is the same pack', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pelago-pack-gone-'));
  try {
    const open = join(root, 'open'), hosted = join(root, 'hosted');
    cpSync(join(PACKS, 'core'), join(open, 'core'), { recursive: true });
    mkdirSync(join(hosted, 'grants'), { recursive: true });
    writeFileSync(join(hosted, 'grants', 'pack.json'), JSON.stringify(GRANTS));
    const db = await openDb();
    const both = new Archipelago(db, new Registry([open, hosted]));
    await syncTypes(both);
    await callTool(both, { ...human, admin: true }, 'pack_set', { pack: 'grants', on: true });
    const { created } = (await both.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'g', type: 'grant', title: 'Seed grant' }] })) as { created: Record<string, string> };
    const before = await packFacts(both);
    assert.ok(before.includes('+pack:grants'), 'the workspace has the pack');

    // Updated to a server that has only the open folder.
    const alone = new Archipelago(db, new Registry([open]));
    const synced = await syncTypes(alone);
    assert.ok(synced.dormant.includes('grant'), 'its type is dormant');
    assert.equal((await alone.entity(created.g))?.title, 'Seed grant', 'the item is still there');
    assert.equal((await alone.change(human, { reason: 'test', ops: [{ op: 'update', id: created.g, title: 'Seed grant 2027' }] })).status, 'applied', 'a person still edits it');
    assert.equal((await alone.change(agent, { reason: 'test', ops: [{ op: 'update', id: created.g, title: 'Seed grant 2028' }] })).status, 'proposed', "an agent's edit waits");
    assert.deepEqual(await packFacts(alone), before, 'the log is not told the pack was taken out');

    // The pack found again, now in the hosted folder only: active, with nothing new said of it.
    const back = new Archipelago(db, new Registry([open, hosted]));
    const again = await syncTypes(back);
    assert.ok(again.activated.includes('grant'));
    assert.equal(back.registry.type('grant')?.dormant, undefined);
    assert.deepEqual(await packFacts(back), before, 'the same pack, by its id');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
