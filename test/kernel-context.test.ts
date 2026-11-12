// The in-process tier (docs/kernel-packs.md): a pack whose manifest carries `kernel` runs in the server's process,
// always on, its code handed one KernelContext held to what it declares. Proved on a small service pack
// (test/packs/kernel_probe).
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { contextFor, hostOf, KernelHost, openKernel } from '../src/kernel-context.ts';
import { callService } from '../src/services.ts';
import { readManifest, tierOf } from '../src/manifest.ts';
import { PackHost } from '../src/packhost.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { readEvents } from '../src/eventlog.ts';
import { flatRead } from '../src/query-flat.ts';
import { freshWith, human, make, PACKS, packsWith } from './map.ts';

const dir = packsWith('kernel_probe');
const probe = (reg: Registry) => reg.found.find((p) => p.id === 'kernel_probe')!;
const manifest = (kernel: unknown, more: Record<string, unknown> = {}) => () => readManifest(JSON.stringify({ id: 'k', version: '1', title: 'K', kernel, ...more }), 'k');

test('the manifest key kernel says a tier, and is refused when it says anything else', () => {
  assert.equal(tierOf(manifest({ trust: 'service', internal: true, hooks: { 'write.follow': 'a.ts#follow' }, calls: { 'answer.brief': { in: { task: 'id' } } } })()), 'service');
  assert.throws(manifest({ trust: 'trusted', internal: true }), /kernel.trust is root or service/);
  assert.throws(manifest({ trust: 'service' }), /kernel.internal is true/);
  assert.throws(manifest({ trust: 'service', internal: true, colour: 1 }), /"kernel.colour" is not a key/);
  assert.throws(manifest({ trust: 'service', internal: true, hooks: { 'write.follow': '../../src/db.ts#open' } }), /names a function of the pack's modules/);
  assert.throws(manifest({ trust: 'root', internal: true, hooks: { 'write.follow': 'a.ts#f' } }), /a root pack opens hook points/);
  assert.throws(manifest({ trust: 'service', internal: true, timers: [{ run: 'a.ts#t', every_ms: 5 }] }), /every_ms/);
  assert.throws(manifest({ trust: 'service', internal: true }, { handlers: [{ event: 'item.due' }] }), /no handlers for the sandbox/);
});

test("an internal pack of the server's own folder is always on, even where the server enables only core", () => {
  const reg = new Registry(dir);
  assert.ok(reg.internal.has('kernel_probe'));
  assert.equal(reg.states.get('kernel_probe')?.state, 'active');
  const only = new Registry(dir, ['core']);
  assert.equal(only.states.get('kernel_probe')?.state, 'active', 'not taken out by the list the server enables');
  assert.equal(only.states.get('findings')?.state, 'off', 'a plain pack still is');
});

test("kernel code from a folder that is not the server's own is refused, and stays off", () => {
  const other = mkdtempSync(join(tmpdir(), 'pelago-hosted-'));
  cpSync(join(import.meta.dirname, 'packs', 'kernel_probe'), join(other, 'kernel_probe'), { recursive: true });
  const reg = new Registry([PACKS, other]);
  assert.equal(reg.states.get('kernel_probe')?.state, 'off');
  assert.match(reg.states.get('kernel_probe')!.why!, /only the server's own packs may/);
  assert.ok(!reg.internal.has('kernel_probe'));
});

test('a hook point is filled by the pack, called with its context: ops in, ops out', async () => {
  const l = await freshWith(new Registry(dir));
  const host = new KernelHost((p) => l.registry.folderOf(p));
  const fills = await host.fillings(l, 'write.follow');
  assert.deepEqual(fills.map((f) => [f.pack, f.ref]), [['kernel_probe', 'probe.ts#follow']]);
  assert.deepEqual(await fills[0].run([{ op: 'create', ref: 'a', type: 'task', title: 'Fix the gate' }, { op: 'update', id: 'e_x' }]), [{ op: 'create', ref: 'seen0', type: 'task', title: 'Seen: Fix the gate' }]);
  assert.deepEqual(await host.fillings(l, 'write.validate'), [], 'a point no pack fills has nothing');
});

test("a service pack's change goes through change as the pack, and it reads what it made", async () => {
  const l = await freshWith(new Registry(dir), { create: 'auto', update: 'auto', link: 'auto' });
  const host = new KernelHost((p) => l.registry.folderOf(p));
  const [timer] = host.timers(l);
  assert.equal(timer.every_ms, 60000);
  const done = (await timer.fire()) as { status: string; id: string; read: { title: string } };
  assert.equal(done.status, 'applied');
  assert.equal(done.read.title, 'Probe ticked');
  const [made] = (await readEvents(l.db, { target: done.id })).filter((e) => e.action === 'entity.create');
  assert.equal(made.actor, 'agent:system:kernel_probe');
  assert.match(JSON.stringify(made.detail), /system: its timer/, "its authority says it is the pack's own");
  // Until the rules know the actor kind system (wave 2: core's system_reach), core's agent_changes holds it where agents' changes wait.
  const held = await freshWith(new Registry(dir));
  assert.equal(((await new KernelHost((p) => held.registry.folderOf(p)).timers(held)[0].fire()) as { status: string }).status, 'proposed');
});

test('a service name is called only as the caller declares it, and answered by its one provider', async () => {
  const l = await freshWith(new Registry(dir));
  const host = openKernel(l);
  assert.equal(hostOf(l), host);
  assert.deepEqual(await callService(l.registry, 'answer.probe', { said: 'by name' }), { said: 'by name', by: 'kernel_probe' }, 'filled at open: the kernel calls it by name');
  const caller: PackFile = { id: 'asker', version: '1', title: 'Asker', uses: ['service:answer.probe'] };
  assert.deepEqual(await host.call(l, caller, 'answer.probe', { said: 'hello' }), { said: 'hello', by: 'kernel_probe' });
  assert.deepEqual(await host.services(l).get('answer.probe')!({ said: 'hi' }), { said: 'hi', by: 'kernel_probe' }, 'what the loader hands fillServices');
  await assert.rejects(host.call(l, { ...caller, uses: [] }, 'answer.probe', {}), /neither requires nor uses/);
  await assert.rejects(host.call(l, { ...caller, uses: ['service:nobody'] }, 'nobody', {}), /No pack here provides service:nobody/);
});

test('the context gives a pack only the streams, secrets and hosts it declares', async () => {
  const l = await freshWith(new Registry(dir));
  const ctx = contextFor(l, probe(l.registry), new KernelHost((p) => l.registry.folderOf(p)));
  assert.equal(ctx.pack.id, 'kernel_probe');
  assert.ok(ctx.pack.hash, 'its hash, as the registry read it');
  await assert.rejects(ctx.record('sessions', []), /a stream none of its rules keeps/);
  await assert.rejects(ctx.secret('github_token'), /its reach does not name/);
  assert.throws(() => ctx.fetch('https://example.com/x'), /a host its reach does not name/);
});

test("an internal pack's code never runs in the sandbox", async () => {
  const l = await freshWith(new Registry(dir));
  const sandbox = new PackHost((p) => l.registry.folderOf(p));
  await assert.rejects(sandbox.call(l, human, 'kernel_probe', 'action', 'x', {}), /runs in the server's process/);
  sandbox.stop();
});

test('a term a pack provides is answered as the viewer who asks, under their row-level security (bug e_8e5pd7dy)', async () => {
  const l = await freshWith(new Registry(dir), { create: 'auto', update: 'auto', link: 'auto' });
  openKernel(l);
  const { bo } = await make(l, [{ op: 'create', ref: 'bo', type: 'person', title: 'Bo', visibility: 'shared' }]);
  const { shown } = await make(l, [{ op: 'create', ref: 'shown', type: 'task', title: 'Shown', visibility: 'shared' }]);
  const mine = (await l.as(bo).change({ kind: 'human', name: 'bo', person: bo }, { reason: 'Mine', ops: [{ op: 'create', ref: 'p', type: 'task', title: 'Bo private', visibility: 'private' }] })) as { created: Record<string, string> };
  const hidden = mine.created.p;
  const asked = async (who: string) => ((await flatRead(l.as(who), { filter: { find: ['type task'], only: [`probe ${hidden} ${shown}`] } })) as { items: { id: string }[] }).items.map((i) => i.id);
  assert.deepEqual(await asked(bo), [shown], 'Bo sees his own item, and so does the term asked for him');
  assert.deepEqual(await asked('e_someone'), [], "asked for someone else, the provider cannot read Bo's private item either");
});
