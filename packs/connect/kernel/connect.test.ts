// The connect pack without a database: what the root services answer goes in, what a person is shown comes out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { installPage, installScript, llmsTxt } from './install.ts';
import { serverPacks } from './server-pack-tools.ts';

/** A context of a workspace whose calls answer from a table of root services; every call is kept. */
const fake = (workspace: string, answers: Record<string, (input: any) => unknown>, calls: [string, unknown][] = []) =>
  ({ workspace, call: async (name: string, input: unknown) => (calls.push([name, input]), answers[name](input)) }) as unknown as KernelContext;

test('an admin of the default workspace is shown what root.server_packs answers', async () => {
  const calls: [string, unknown][] = [];
  const shown = { packs: [{ id: 'reader', version: '1', acts: [], pages: [], entries: [], webhooks: [] }], refused: [] };
  assert.deepEqual(await serverPacks(fake('default', { 'root.server_packs': () => shown }, calls), { admin: true }), shown);
  assert.deepEqual(calls, [['root.server_packs', {}]]);
});

test('nobody else is shown the server packs, and nothing is asked', async () => {
  const calls: [string, unknown][] = [];
  const ctx = (ws: string) => fake(ws, { 'root.server_packs': () => ({}) }, calls);
  await assert.rejects(serverPacks(ctx('default'), { admin: false }), /default workspace/);
  await assert.rejects(serverPacks(ctx('other'), { admin: true }), /default workspace/);
  assert.deepEqual(calls, []);
});

test('the install texts carry this server\'s address, its listing and the rules they are handed', () => {
  const origin = 'https://example.test';
  assert.match(installPage(origin), /^# Install Archipelago/);
  assert.ok(installPage(origin).includes(`${origin}/connect/install.mjs`));
  assert.ok(llmsTxt(origin).includes(`${origin}/mcp`));
  const script = installScript(origin, '# the rules');
  assert.ok(script.startsWith(`const ORIGIN = ${JSON.stringify(origin)};`));
  assert.ok(script.includes(JSON.stringify('# the rules')));
});
