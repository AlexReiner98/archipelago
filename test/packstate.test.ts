// Pack states on a running server: a pack turned off and on again, with a connected agent's tool list following it
// and the pack's items staying readable and editable as dormant.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { Archipelago } from '../src/pelago.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { followPacks, setPack } from '../src/packstate.ts';
import { freshWith, human, PACKS } from './map.ts';
import { orderPacks } from '../src/packorder.ts';
import { createHttpServer } from '../src/server.ts';
import { Workspaces } from '../src/workspaces.ts';

/** A pack written for the test: one type and one action, so turning it off takes both away. */
const TALLY = {
  id: 'tally', version: '0.1.0', title: 'Tally', description: 'Counts kept by hand.', requires: ['core'],
  types: [{ id: 'tally_entry', title: 'Tally entry', description: 'A count kept on a day.', extends: 'record', fields: { date: { type: 'date' }, n: { type: 'number' } } }],
  actions: [{ id: 'tally.log', title: 'Log a count', verb: 'capture', description: 'Log a count.', input: { type: 'object', properties: {}, additionalProperties: false } }],
};

/** A folder of packs: core as in the repository, and the tally pack. */
function packsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-packstate-'));
  cpSync(join(PACKS, 'core'), join(dir, 'core'), { recursive: true });
  mkdirSync(join(dir, 'tally'));
  writeFileSync(join(dir, 'tally', 'pack.json'), JSON.stringify(TALLY));
  writeFileSync(join(dir, 'tally', 'handler.js'), "export default { async 'tally.log'() { return { ops: [] }; } };\n");
  return dir;
}
const fresh = () => freshWith(new Registry(packsDir()));

const closers: (() => Promise<void>)[] = [];
after(async () => {
  for (const close of closers) await close();
});

async function serve() {
  const root = mkdtempSync(join(tmpdir(), 'pelago-packstate-'));
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: packsDir() });
  const probe = createHttpServer(workspaces, 0);
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const server = createHttpServer(workspaces, port, { auth: 'off' });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  closers.push(async () => {
    server.close();
    await workspaces.closeAll();
  });
  const base = `http://127.0.0.1:${port}`;
  const api = async (name: string, body: unknown = {}) => {
    const res = await fetch(`${base}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return (await res.json()) as { result?: any; error?: string };
  };
  return { base, api };
}

test('packs wait for what they require, and the server starts whatever their states', () => {
  const pack = (id: string, requires: string[] = ['core']): PackFile => ({ id, version: '1', title: id, requires });
  const found = new Map([pack('core', []), pack('clock'), pack('billing', ['clock']), pack('crm', ['nowhere'])].map((p) => [p.id, p]));
  const { ordered, states } = orderPacks(found, new Map([['clock', 'turned off here']]), 'local');
  assert.deepEqual(ordered.map((p) => p.id), ['core']);
  assert.deepEqual(Object.fromEntries(states), {
    core: { state: 'active' },
    clock: { state: 'off', why: 'turned off here' },
    billing: { state: 'waiting', why: 'needs clock, which is off' },
    crm: { state: 'waiting', why: 'needs nowhere, which is not on this server' },
  });
  const reg = new Registry(packsDir());
  reg.turnOff(['tally', 'core']);
  assert.equal(reg.states.get('tally')!.state, 'off');
  assert.equal(reg.states.get('core')!.state, 'active', "the kernel's packs stay on");
});

test("a pack turned off and on again on a running server: a connected agent's tools follow, its items stay", async () => {
  const { base, api } = await serve();
  const client = new Client({ name: 'test', version: '1' });
  let changed = 0;
  let heard: () => void = () => {};
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
    changed++;
    heard();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  closers.push(() => client.close());
  // A pack's action is offered under its verb: the capture tool's description names tally.log while the pack is on.
  const names = async () => [...((await client.listTools()).tools.find((t) => t.name === 'capture')?.description ?? '').matchAll(/\b([a-z]+)\.([a-z_]+) \(/g)].map((m) => `${m[1]}_${m[2]}`);
  const told = () => new Promise<void>((resolve, reject) => ((heard = resolve), setTimeout(() => reject(new Error('not told')), 5000)));
  assert.ok((await names()).includes('tally_log'));

  const made = await api('change', { reason: 'test', ops: [{ op: 'create', ref: 'e', type: 'tally_entry', title: 'Drafting', props: { date: '2026-10-16', n: 3 } }] });
  const entry = made.result.created.e as string;

  const hearing = told();
  const off = await api('pack_set', { pack: 'tally', on: false });
  const tally = off.result.packs.find((p: { id: string }) => p.id === 'tally');
  assert.deepEqual({ id: tally.id, title: tally.title, version: tally.version, state: tally.state, why: tally.why }, { id: 'tally', title: 'Tally', version: '0.1.0', state: 'off', why: 'turned off here' });
  // What it touches is read from its manifest, grouped as the Workspace page shows it, its names in words.
  const types = tally.touches.find((t: { key: string }) => t.key === 'types');
  assert.ok(types.n > 0 && types.items.some((t: { name: string; about: string }) => t.name === 'Tally entry' && t.about));
  assert.ok(off.result.dormant.includes('tally_entry'));
  await hearing;
  assert.ok(!(await names()).includes('tally_log'), 'the tool left the list');
  assert.equal((await api('get', { id: entry })).result.entity.title, 'Drafting', 'its item is still there');
  assert.equal((await api('change', { reason: 'test', ops: [{ op: 'update', id: entry, title: 'Drafting the grant' }] })).result.status, 'applied', 'and a person can edit it');

  const back = told();
  await api('pack_set', { pack: 'tally', on: true });
  await back;
  assert.ok((await names()).includes('tally_log'), 'the tool is back');
  assert.equal(changed >= 2, true);
  assert.equal((await api('packs')).result.find((p: { id: string }) => p.id === 'tally').state, 'active');
});

test('a pack turned off on one server is followed by another on the same database', async () => {
  const one = await fresh();
  const other = new Archipelago(one.db, new Registry(one.registry.dir));
  assert.equal(await followPacks(other), false, 'nothing to follow yet');
  await setPack(one, human, { pack: 'tally', on: false });
  assert.equal(other.registry.states.get('tally')!.state, 'active', 'the other server has not looked yet');
  assert.equal(await followPacks(other), true);
  assert.equal(other.registry.states.get('tally')!.state, 'off');
  assert.equal(await followPacks(other), false, 'no reload when nothing changed');
  await setPack(one, human, { pack: 'tally', on: true });
  assert.equal(await followPacks(other), true);
  assert.equal(other.registry.states.get('tally')!.state, 'active');
});

test('an owner signed in turns a pack off and on: the type table is the system’s, kept whole whoever asked', async () => {
  const l = await fresh();
  // Signed in, a person's acts run as the member role, which may only read the type table.
  const owner = l.as('e_owner01', true);
  const state = async (id: string) => (await l.db.query<{ state: string }>(`select state from type_def where id = $1`, [id])).rows[0]?.state;
  assert.deepEqual((await setPack(owner, human, { pack: 'tally', on: false })).dormant.includes('tally_entry'), true);
  assert.equal(await state('tally_entry'), 'dormant');
  assert.deepEqual((await setPack(owner, human, { pack: 'tally', on: true })).activated.includes('tally_entry'), true);
  assert.equal(await state('tally_entry'), 'active');
});
