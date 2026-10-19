// Pack states on a running server: a pack turned off and on again, with a connected agent's tool list following it
// and the pack's items staying readable and editable as dormant.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
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
import { fresh, human } from './map.ts';
import { orderPacks } from '../src/packorder.ts';
import { createHttpServer } from '../src/server.ts';
import { Workspaces } from '../src/workspaces.ts';

const closers: (() => Promise<void>)[] = [];
after(async () => {
  for (const close of closers) await close();
});

async function serve() {
  const root = mkdtempSync(join(tmpdir(), 'pelago-packstate-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), join(root, 'packs'), { recursive: true });
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: join(root, 'packs') });
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
  const found = new Map([pack('core', []), pack('time'), pack('billing', ['time']), pack('crm', ['nowhere'])].map((p) => [p.id, p]));
  const { ordered, states } = orderPacks(found, new Map([['time', 'turned off here']]), 'local');
  assert.deepEqual(ordered.map((p) => p.id), ['core']);
  assert.deepEqual(Object.fromEntries(states), {
    core: { state: 'active' },
    time: { state: 'off', why: 'turned off here' },
    billing: { state: 'waiting', why: 'needs time, which is off' },
    crm: { state: 'waiting', why: 'needs nowhere, which is not on this server' },
  });
  const dir = mkdtempSync(join(tmpdir(), 'pelago-packstate-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  const reg = new Registry(dir);
  reg.turnOff(['time', 'core']);
  assert.equal(reg.states.get('time')!.state, 'off');
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
  const names = async () => (await client.listTools()).tools.map((t) => t.name);
  const told = () => new Promise<void>((resolve, reject) => ((heard = resolve), setTimeout(() => reject(new Error('not told')), 5000)));
  assert.ok((await names()).includes('time_log'));

  const made = await api('change', { reason: 'test', ops: [{ op: 'create', ref: 'e', type: 'time.entry', title: 'Drafting', props: { date: '2026-10-16', hours: 3 } }] });
  const entry = made.result.created.e as string;

  const hearing = told();
  const off = await api('pack_set', { pack: 'time', on: false });
  assert.deepEqual(off.result.packs.find((p: { id: string }) => p.id === 'time'), { id: 'time', title: 'Time', version: '0.1.0', state: 'off', why: 'turned off here' });
  assert.ok(off.result.dormant.includes('time.entry'));
  await hearing;
  assert.ok(!(await names()).includes('time_log'), 'the tool left the list');
  assert.equal((await api('get', { id: entry })).result.entity.title, 'Drafting', 'its item is still there');
  assert.equal((await api('change', { reason: 'test', ops: [{ op: 'update', id: entry, title: 'Drafting the grant' }] })).result.status, 'applied', 'and a person can edit it');

  const back = told();
  await api('pack_set', { pack: 'time', on: true });
  await back;
  assert.ok((await names()).includes('time_log'), 'the tool is back');
  assert.equal(changed >= 2, true);
  assert.equal((await api('packs')).result.find((p: { id: string }) => p.id === 'time').state, 'active');
});

test('a pack turned off on one server is followed by another on the same database', async () => {
  const one = await fresh();
  const other = new Archipelago(one.db, new Registry(one.registry.dir));
  assert.equal(await followPacks(other), false, 'nothing to follow yet');
  await setPack(one, human, { pack: 'time', on: false });
  assert.equal(other.registry.states.get('time')!.state, 'active', 'the other server has not looked yet');
  assert.equal(await followPacks(other), true);
  assert.equal(other.registry.states.get('time')!.state, 'off');
  assert.equal(await followPacks(other), false, 'no reload when nothing changed');
  await setPack(one, human, { pack: 'time', on: true });
  assert.equal(await followPacks(other), true);
  assert.equal(other.registry.states.get('time')!.state, 'active');
});
