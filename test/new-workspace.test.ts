// What a workspace begins with (the owner, 21 Oct and 1 Nov 2026): a new one applies what its agents change, from the
// moment it is made, on every way of making one; one that exists and never chose stays held; what stays the owner's stays so.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dump } from '../src/backup.ts';
import { islandsOn, setIslands } from '../src/packstate.ts';
import { dumpVault } from '../src/vault.ts';
import { callTool } from '../src/tools.ts';
import { Workspaces } from '../src/workspaces.ts';
import type { Actor, Op } from '../src/pelago.ts';
import { mayDo } from '../src/rules.ts';
import { packsWith } from './map.ts';

const agent: Actor = { kind: 'agent', name: 'robot' };
const person: Actor = { kind: 'human', name: 'alex' };
const task = { op: 'create', type: 'task', title: 'Paint the fence' } as const;
// The repository's packs and a test pack with a type that can be public (test/packs/reader).
const PACKS = packsWith('reader');
const servers = () => {
  const root = mkdtempSync(join(tmpdir(), 'pelago-new-'));
  return { rootDir: join(root, 'workspaces'), dataDir: join(root, 'data'), packsDir: PACKS };
};

test('a new workspace applies what its agents change before it has an owner, and its log says why', async () => {
  const at = new Workspaces({ ...servers(), dataDir: null });
  const { pelago: l } = await at.create('acme', 'Acme');
  assert.equal(await l.agentChanges(), 'apply');
  assert.equal(await l.setting('me'), undefined, 'nobody has signed in');
  assert.equal((await l.change(agent, { ops: [task], reason: 'first write' })).status, 'applied');
  const { rows } = await l.db.query<{ n: number }>(`select count(*)::int as n from log_op where stream = 'settings'`);
  assert.equal(rows[0].n, 2, 'what agents may do, and that it is on islands');
  await at.closeAll();
});

test('the default workspace of a new server begins the same way', async () => {
  const at = new Workspaces({ ...servers(), dataDir: null });
  assert.equal(await (await at.get('default')).pelago.agentChanges(), 'apply');
  await at.closeAll();
});

test('a server’s fresh default map starts on islands, with one to start on; one opened again keeps what it has', async () => {
  const config = { ...servers(), defaultOnIslands: true };
  const one = new Workspaces(config);
  const { pelago: l } = await one.get('default');
  assert.equal(await islandsOn(l), true);
  const islandsOf = async (at: Workspaces) => ((await callTool((await at.get('default')).pelago, person, 'search', { type: 'island' })) as { title: string }[]).map((i) => i.title);
  const islands = await islandsOf(one);
  assert.deepEqual(islands, ['Default']);
  assert.equal((await l.change(agent, { ops: [task], reason: 'first write' })).status, 'applied', 'an agent’s first change just works');
  await one.closeAll();
  // Opened again it is not begun again: no second island.
  const two = new Workspaces(config);
  assert.deepEqual(await islandsOf(two), ['Default']);
  await two.closeAll();
  // Without it (the tests), a fresh default map is plain.
  const plain = new Workspaces({ ...servers(), dataDir: null });
  assert.equal(await islandsOn((await plain.get('default')).pelago), false);
  await plain.closeAll();
});

test('an owner who chose hold keeps it, through their first sign-in and opening again', async () => {
  const config = servers();
  const one = new Workspaces(config);
  const { pelago: l } = await one.create('acme', 'Acme');
  await l.db.query(`update setting set value = '"hold"' where key = 'agent_changes'`);
  await l.init(person, { name: 'Alex' });
  assert.equal(await l.agentChanges(), 'hold');
  await one.closeAll();
  const two = new Workspaces(config);
  assert.equal(await (await two.get('acme')).pelago.agentChanges(), 'hold');
  await two.closeAll();
});

test('a workspace that exists and never chose is left held by an upgrade, and by its owner signing in again', async () => {
  const config = servers();
  const one = new Workspaces(config);
  const { pelago: was } = await one.create('old', 'Old');
  await was.init(person, { name: 'Alex' });
  await was.db.query(`delete from setting where key = 'agent_changes'`); // as one made before 21 Oct 2026 is
  await one.closeAll();

  const two = new Workspaces(config);
  const { pelago: l } = await two.get('old');
  assert.equal(await l.agentChanges(), 'hold');
  assert.equal(await l.setting('agent_changes'), undefined, 'and nothing was chosen for it');
  assert.equal((await l.change(agent, { ops: [task], reason: 'after the upgrade' })).status, 'proposed');
  await l.init(person, { name: 'Alex' });
  assert.equal(await l.agentChanges(), 'hold');
  await two.closeAll();
});

test('a map brought in from a backup keeps what it was set to, or that it never chose', async () => {
  const at = new Workspaces({ ...servers(), dataDir: null });
  const { pelago: from } = await at.create('from', 'From');
  await from.db.query(`delete from setting where key = 'agent_changes'`);
  const { pelago: l } = await at.create('to', 'To', { ...(await dump(from.db, { id: 'from', name: 'From' })), vault: await dumpVault(from.db) }); // its first island is sealed
  assert.equal(await l.agentChanges(), 'hold');
  await at.closeAll();
});

test('a new workspace still keeps from its agents what the core rules keep', async () => {
  const at = new Workspaces({ ...servers(), dataDir: null });
  const { pelago: l } = await at.create('acme', 'Acme');
  await setIslands(l, 'system', false); // the test pack's types live on no core island; this is about the core rules
  const made = async (ops: Op[]) => (await l.change(agent, { ops, reason: 'the core rules' })).status;
  assert.equal(await made([{ op: 'create', type: 'writing', title: 'Guide', visibility: 'public' }]), 'proposed', 'what is public');
  assert.equal(await made([{ op: 'create', type: 'layout', title: 'Loud', props: { code: 'export default () => []' } }]), 'proposed', 'code that runs');
  assert.equal(await made([{ op: 'create', type: 'screen', title: 'Board' }]), 'proposed', 'screens');
  assert.equal(await made([{ op: 'create', ref: 'a', type: 'automation', title: 'Nightly', status: 'paused', props: { trigger: 'daily', at: '03:00', action: 'notify', message: 'hi' } }, { op: 'create', ref: 't', type: 'task', title: 'Its subject' }, { op: 'link', type: 'about', from: 'a', to: 't' }]), 'proposed', 'automations');
  await assert.rejects(mayDo(l.db, l.registry, false, 'publish'), /Publishing is the owner/);
  await assert.rejects(mayDo(l.db, l.registry, false, 'backup_download'), /backups/);
  await at.closeAll();
});

test('a settle waits for the owner wherever changes wait, and where they apply it is put to the owner with what was chosen and why', async () => {
  const at = new Workspaces({ ...servers(), dataDir: null });
  const { pelago: l } = await at.create('acme', 'Acme');
  await l.init(person, { name: 'Alex' });
  const { d } = ((await l.change(person, { ops: [{ op: 'create', ref: 'd', type: 'decision', title: 'Which way?' }], reason: 'a question' })) as { created: Record<string, string> }).created;
  const settle = { op: 'update', id: d, status: 'decided', props: { outcome: 'this', rationale: 'that' } } as const;
  const said = { of: 'agent', basis: 'the test' } as const;

  await l.db.query(`update setting set value = '"hold"' where key = 'agent_changes'`);
  const held = await l.change(agent, { ops: [settle], reason: 'settle it', authority: said });
  assert.deepEqual([held.status, (held as { held_by?: { rule: string } }).held_by?.rule], ['proposed', 'settle']);

  await l.db.query(`delete from setting where key = 'agent_changes'`);
  assert.equal((await l.change(agent, { ops: [settle], reason: 'settle it', authority: said })).status, 'proposed', 'a workspace that never chose: and a server that lifts agents’ changes does not lift this');

  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"')`);
  await assert.rejects(l.change(agent, { ops: [{ op: 'update', id: d, status: 'decided' }], reason: 'bare', authority: said }), /what was chosen/);
  await assert.rejects(l.change(agent, { ops: [settle], reason: 'unsaid' }), /on whose authority/);
  assert.equal((await l.change(agent, { ops: [settle], reason: 'settle it', authority: said })).status, 'applied');
  const asked = (await callTool(l, person, 'view', { name: 'attention', params: { person: 'me', reasons: ['to_confirm'] } })) as { items: { id: string }[] };
  assert.deepEqual(asked.items.map((i) => i.id), [d], 'and the owner is asked to confirm it');
  await at.closeAll();
});
