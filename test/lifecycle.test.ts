// A workspace's lifecycle (docs/kernel-packs.md, "Slots", "The boot stub"): it opens on the root packs, then phase by
// phase as the packs fill open.<phase>, and runs the duties packs declare only while this server leads. Proved on the
// clock, a timer of the clocks pack, and on a service pack that fills phases and runs a timer (test/packs/kernel_open).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OPEN_PHASES } from '../src/boot.ts';
import { kernelDuties, kernelFillings } from '../packs/identity/kernel/lifecycle.ts';
import { Workspaces } from '../packs/identity/kernel/workspaces.ts';
import { PACKS, packsWith } from './map.ts';

const seen: string[] = ((globalThis as { kernelOpenSeen?: string[] }).kernelOpenSeen ??= []);
const at = (packsDir: string, more: Partial<ConstructorParameters<typeof Workspaces>[0]> = {}) =>
  new Workspaces({ dataDir: null, rootDir: join(mkdtempSync(join(tmpdir(), 'pelago-life-')), 'workspaces'), packsDir, ...more });

/** Wait for a condition the server reaches by itself, or fail after five seconds. */
async function until(what: string, ok: () => Promise<boolean> | boolean): Promise<void> {
  const end = Date.now() + 5000;
  while (!(await ok())) {
    if (Date.now() > end) assert.fail(`${what}: not within 5 s`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("what Workspaces.load did in a fixed order is the roots' and the kernel's fillings of the open phases, each under its pack", async () => {
  await import('../packs/identity/kernel/workspaces.ts');
  const filled = await kernelFillings();
  assert.deepEqual(filled, [
    { phase: 'restore', pack: 'log' },
    { phase: 'restore', pack: 'identity' },
    { phase: 'packs', pack: 'loader' },
    { phase: 'packs', pack: 'write' },
    { phase: 'types', pack: 'log' },
    { phase: 'types', pack: 'loader' },
    { phase: 'types', pack: 'loader' },
    { phase: 'begin', pack: 'rules' },
    { phase: 'islands', pack: 'loader' },
  ]);
  for (const f of filled) assert.ok((OPEN_PHASES as readonly string[]).includes(f.phase));
  assert.deepEqual((await kernelDuties()).sort(), ['loader', 'log', 'surface'], 'the clock is the clocks pack’s own timer (kernel.timers), the log is kept by its root, and the loader beats loader.leading (the quiet look is sessions’ filling)');
});

test('the clock runs only while this server leads, and stops when it loses the lead', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const spaces = at(PACKS);
  const { pelago: l } = await spaces.get('default');
  t.mock.timers.tick(120_000);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await l.setting('due_cursor'), undefined, 'a server that follows runs no clock');
  await spaces.lead(true);
  t.mock.timers.tick(60_000);
  await until('the clock passed', async () => (await l.setting('due_cursor')) !== undefined);
  const first = await l.setting<number>('due_cursor');
  await spaces.lead(false);
  t.mock.timers.tick(180_000);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await l.setting('due_cursor'), first, 'no pass once the lead is lost');
  await spaces.closeAll();
});

test("an internal pack fills the open phases after the registry is made, and its timer runs while the server leads", async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  seen.length = 0;
  const spaces = at(packsWith('kernel_open'));
  await spaces.get('default');
  assert.deepEqual(seen, ['begin default true', 'ready default'], 'begin before ready, the starter types loaded');
  await spaces.lead(true);
  await until('the leading tick', () => seen.includes('tick default'));
  seen.length = 0;
  t.mock.timers.tick(60_000);
  await until('the next tick', () => seen.includes('tick default'));
  await spaces.lead(false);
  seen.length = 0;
  t.mock.timers.tick(120_000);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, [], 'a follower runs no timer');
  await spaces.closeAll();
});

test('a workspace opens on the root packs before its phases, and closes on them when it closes', async () => {
  const calls: string[] = [];
  seen.length = 0;
  const boot = {
    open: async (ws: string, leading?: boolean) => void calls.push(`open ${ws} ${leading} ${seen.length}`),
    close: async (ws: string) => void calls.push(`close ${ws}`),
  };
  const spaces = at(packsWith('kernel_open'), { boot });
  await spaces.get('default');
  assert.deepEqual(calls, ['open default false 0'], "the roots open first; their timers are not run from here");
  assert.deepEqual(seen, ['begin default true', 'ready default']);
  await spaces.closeAll();
  assert.deepEqual(calls, ['open default false 0', 'close default']);
});

test('a workspace that fails to open is closed again on the root packs', async () => {
  const calls: string[] = [];
  const boot = { open: async (ws: string) => void calls.push(`open ${ws}`), close: async (ws: string) => void calls.push(`close ${ws}`) };
  const spaces = at(join(tmpdir(), 'pelago-no-packs-here'), { boot });
  await assert.rejects(spaces.get('default'));
  assert.deepEqual(calls, ['open default', 'close default']);
  await spaces.closeAll();
});
