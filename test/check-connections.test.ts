// check_connections, the connect pack's filling of surface.act (the owner, 12 Nov 2026, e_gc8stacv): it calls each
// connection's own URL through its context (reach.items) and hands what it saw to the write root (root.observe), and
// the log holds what it held before: an observation by whoever asked for the check, and when the status changed, the
// status set and a line in the activity by them.

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { fresh, human, make } from './map.ts';
import { kernelContext, openKernel } from '../packs/loader/kernel/kernel-context.ts';
import { readOps } from '../packs/log/kernel/streams.ts';
import { readEvents } from '../packs/log/kernel/eventlog.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';

const local: Server = createServer((_req, res) => res.setHeader('connection', 'close').writeHead(204).end());
await new Promise<void>((r) => local.listen(0, '127.0.0.1', r));
const port = () => (local.address() as AddressInfo).port;
after(() => {
  local.closeAllConnections();
  local.close();
});

test('a check is recorded as the one who asked it: the observation, the status, the line in the activity', async () => {
  const before = [process.env.PELAGO_PRIVATE_URLS, process.env.PELAGO_MODEL_PRIVATE_URLS];
  delete process.env.PELAGO_PRIVATE_URLS; // this machine's addresses may be called here
  delete process.env.PELAGO_MODEL_PRIVATE_URLS;
  try {
    const l = await fresh();
    openKernel(l);
    const { up, gone, shut } = await make(l, [
      { op: 'create', ref: 'up', type: 'connection', title: 'Up', status: 'unavailable', props: { url: `http://127.0.0.1:${port()}/` } },
      { op: 'create', ref: 'gone', type: 'connection', title: 'Gone', props: { url: 'http://127.0.0.1:1/' } },
      { op: 'create', ref: 'shut', type: 'connection', title: 'Shut', status: 'unavailable', props: { url: `http://127.0.0.1:${port()}/shut` } },
    ]);
    await l.change(human, { reason: 'test', ops: [{ op: 'archive', id: shut }] }, true);
    const out = (await callTool(l, human, 'check_connections', {})) as { id: string; status: string }[];
    assert.deepEqual(Object.fromEntries(out.map((c) => [c.id, c.status])), { [up]: 'available', [gone]: 'unavailable' }, 'an archived connection is not checked');

    const seen = (await readOps(l.db, 'observations')).filter((e) => e.rule === 'observations');
    assert.deepEqual(seen.map((e) => e.actor.id), ['human:test', 'human:test'], 'by who asked, not by the pack');
    assert.deepEqual(seen.flatMap((e) => e.facts).sort((a, b) => String(a[1]).localeCompare(String(b[1]))), [['+', up, 'status', 'available'], ['+', gone, 'status', 'unavailable']].sort((a, b) => String(a[1]).localeCompare(String(b[1]))));

    for (const [id, status] of [[up, 'available'], [gone, 'unavailable']]) {
      assert.equal((await l.entity(id))!.status, status);
      const lines = await readEvents(l.db, { target: id, action: 'connection.check' });
      assert.equal(lines.length, 1);
      assert.equal(lines[0].actor, 'human:test');
      assert.equal(lines[0].reason, 'Reachability changed');
      assert.equal(lines[0].detail.to, status);
    }

    // Asked again with nothing changed: an observation each, and no new line in the activity.
    await callTool(l, human, 'check_connections', {});
    assert.equal((await readEvents(l.db, { action: 'connection.check' })).length, 2);
  } finally {
    for (const [key, value] of [['PELAGO_PRIVATE_URLS', before[0]], ['PELAGO_MODEL_PRIVATE_URLS', before[1]]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("the pack's context calls only what a connection keeps, and only connect may observe", async () => {
  const l = await fresh();
  const { conn, task } = await make(l, [
    { op: 'create', ref: 'conn', type: 'connection', title: 'Kept', props: { url: 'http://127.0.0.1:1/kept' } },
    { op: 'create', ref: 'task', type: 'task', title: 'Not a connection' },
  ]);
  const ctx = kernelContext(l, 'connect');
  await assert.rejects(ctx.fetch('http://127.0.0.1:1/other'), /a host its reach does not name/);
  await assert.rejects(ctx.fetch('http://127.0.0.1:1/kept'), (err: Error) => !/reach does not name/.test(err.message), 'its own URL is let through the reach (and refused only by the network)');
  await assert.rejects(ctx.call('root.observe', { id: task, status: 'available', by: 'human:test' }), /no connection/);
  await assert.rejects(kernelContext(l, 'agents').call('root.observe', { id: conn, status: 'available', by: 'human:test' }), /neither requires nor uses|may not call/);
});
