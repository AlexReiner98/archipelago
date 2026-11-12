// The surface's slots (docs/kernel-packs.md, "Slots"): the surface keeps each action's words, its verb and who may
// call it; what it does is a filling, by the kernel's own module until a pack takes it, or by an internal pack's hook.
// Proved on rechecked (src/recheck.ts) and the backup file route (src/backup-route.ts).
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { test } from 'node:test';
import { openKernel } from '../src/kernel-context.ts';
import { Registry } from '../src/packs.ts';
import { filledTool, serveFilled, slotted, type RouteHost } from '../src/surface-slots.ts';
import { annotationsOf } from '../src/surface.ts';
import { callTool, surfaceFor } from '../src/tools.ts';
import { agent, freshWith, human, PACKS, packsWith } from './map.ts';

test('rechecked is offered under report as before, its behaviour the kernel module that fills it', async () => {
  const l = await freshWith(new Registry(PACKS, ['core']));
  assert.ok(await filledTool(l, 'surface.act', 'rechecked'), 'the kernel fills it until its pack takes it');
  assert.equal(await filledTool(l, 'surface.act', 'probe_act'), undefined, 'a name nothing fills');
  await assert.rejects(callTool(l, agent, 'report', { action: 'rechecked', params: { repo: 'anything' } }), /No pack here keeps scheduled re-checks/, 'the verb routes onto the filling');
  await assert.rejects(slotted('surface.act', 'probe_act')(l, agent, {}), /Nothing here fills probe_act \(surface.act\)/);
});

test("an internal pack fills an act and a read, called with its context and who asked", async () => {
  const l = await freshWith(new Registry(packsWith('act_probe')), { create: 'auto', update: 'auto', link: 'auto' });
  openKernel(l);
  const act = (await filledTool(l, 'surface.act', 'probe_act'))!;
  assert.deepEqual(await act(l, agent, { said: 'hi' }), { said: 'hi', who: `agent:${agent.name}`, by: 'act_probe' });
  const made = await l.change(agent, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'task', title: 'Read me' }] }, true);
  const id = (made as { created: Record<string, string> }).created.a;
  const read = (await filledTool(l, 'surface.read', 'probe_read'))!;
  assert.equal(((await read(l, agent, { id })) as { title: string }).title, 'Read me');
  assert.equal(await filledTool(l, 'surface.act', 'probe_read'), undefined, 'a read fills its own slot, not the acts');
});

test('a name two fill is refused, naming both: one name, one owner', async () => {
  const l = await freshWith(new Registry(packsWith('act_probe')));
  openKernel(l);
  await assert.rejects(filledTool(l, 'surface.act', 'rechecked'), /rechecked is filled by the kernel and the act_probe pack: one name, one owner/);
  await assert.rejects(callTool(l, agent, 'rechecked', { repo: 'x' }), /one name, one owner/);
});

test('a route filling answers before the server, counting its requests against the limit it names', async () => {
  const asked: string[] = [];
  let status = 0;
  const res = { writeHead: (s: number) => ((status = s), res), end: () => res, setHeader: () => res } as unknown as ServerResponse;
  const host = { workspaces: { has: async () => false }, tooOften: (limit: string) => (asked.push(limit), false) } as unknown as RouteHost;
  const get = (url: string) => ({ method: 'GET', url }) as IncomingMessage;
  assert.equal(await serveFilled(get('/backup-file/ws/key'), res, '/backup-file/ws/key', host), true);
  assert.deepEqual(asked, ['open']);
  assert.equal(status, 404, 'no such workspace: no backup');
  assert.equal(await serveFilled(get('/elsewhere'), res, '/elsewhere', host), false);
  assert.equal(await serveFilled({ method: 'POST' } as IncomingMessage, res, '/backup-file/ws/key', host), false, 'by method too');
  const refusing = { ...host, tooOften: () => true } as RouteHost;
  status = 0;
  assert.equal(await serveFilled(get('/backup-file/ws/key'), res, '/backup-file/ws/key', refusing), true);
  assert.equal(status, 0, 'asked too often: the limit answered it');
});

test('a pack declares an action under a verb of its own, its code in-process', async () => {
  const l = await freshWith(new Registry(packsWith('verb_probe')));
  openKernel(l);
  const names = surfaceFor(l.registry).map(([name]) => name);
  assert.deepEqual(names.slice(-2), ['probe', 'draw'], 'its verb is a tool of the surface, before draw');
  assert.equal(annotationsOf(l.registry, 'probe').title, 'Probe');
  assert.match(String((surfaceFor(l.registry).find(([n]) => n === 'probe')![1]).description), /verb_probe\.ping/, 'the verb lists its action');
  assert.deepEqual(await callTool(l, agent, 'probe', { action: 'ping', params: { said: 'hi' } }), { said: 'hi', who: `agent:${agent.name}`, by: 'verb_probe' }, 'run in-process, not in the sandbox');
  assert.deepEqual(await callTool(l, agent, 'verb_probe_ping', { said: 'yo' }), { said: 'yo', who: `agent:${agent.name}`, by: 'verb_probe' }, 'by its tool name too');
  await assert.rejects(callTool(l, agent, 'report', { action: 'ping', params: { said: 'hi' } }), /"verb_probe.ping" is a probe: call probe/);
  await assert.rejects(callTool(l, agent, 'probe', { action: 'hush', params: {} }), /for humans only/);
  assert.deepEqual(await callTool(l, human, 'probe', { action: 'hush', params: {} }), { hushed: true });
  const core = await freshWith(new Registry(PACKS, ['core']));
  assert.ok(!surfaceFor(core.registry).some(([name]) => name === 'probe'), 'a map without the pack offers the ten');
});
