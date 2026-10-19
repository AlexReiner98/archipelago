// Health reported from outside: Uptime Kuma's webhook body read as a reading, the rule a watched status follows, and
// a report taking a part down and back up through the write path, with the monitor's words as the reason.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { checkCapabilities } from '../src/capabilities.ts';
import { openDb } from '../src/db.ts';
import { nextStatus, readKuma, sameAddress } from '../src/health.ts';
import { Registry } from '../src/packs.ts';
import { hostFor } from '../src/packtools.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { callTool } from '../src/tools.ts';

const owner: Actor = { kind: 'human', name: 'owner' };
const kuma: Actor = { kind: 'agent', name: 'Uptime Kuma' };
const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

/** Kuma's webhook body, as its notification posts it. */
const beat = (status: number, monitor: Record<string, unknown>, msg = '') => ({ heartbeat: { monitorID: 3, status, msg, important: true }, monitor, msg: `[${monitor.name}] ${msg}` });

test('a Kuma heartbeat is read for its addresses, its name and whether it is up', () => {
  const http = readKuma(beat(0, { name: 'LiteLLM', type: 'http', url: 'http://LiteLLM:4000/health/liveliness/', hostname: null, port: null }, 'connect ECONNREFUSED'));
  assert.deepEqual(http, { up: false, addresses: ['http://litellm:4000/health/liveliness'], name: 'LiteLLM', said: 'connect ECONNREFUSED' });
  const port = readKuma(beat(1, { name: 'Postgres', type: 'port', url: 'https://', hostname: 'postgres', port: 5432 }, 'OK'));
  assert.deepEqual(port.addresses, ['tcp://postgres:5432']);
  assert.equal(port.up, true);
  assert.deepEqual(readKuma(beat(1, { name: 'App', type: 'docker', docker_container: 'archipelago-app-blue-1' })).addresses, ['docker://archipelago-app-blue-1']);
  assert.equal(readKuma(beat(2, { name: 'App' })).up, undefined, 'pending is neither');
  assert.equal(sameAddress('HTTPS://App.Example.com/Health/'), 'https://app.example.com/Health');
});

test('a watched status goes down from up or degraded, back up from down, and is left alone while being built', () => {
  const watch = { field: 'url', up: 'up', down: 'down', also: ['degraded'] };
  assert.equal(nextStatus(watch, 'up', false), 'down');
  assert.equal(nextStatus(watch, 'degraded', false), 'down');
  assert.equal(nextStatus(watch, 'down', true), 'up');
  assert.equal(nextStatus(watch, 'degraded', true), undefined, 'degraded is someone’s word: an answer does not overrule it');
  assert.equal(nextStatus(watch, 'up', true), undefined);
  assert.equal(nextStatus(watch, 'wiring', false), undefined);
  assert.equal(nextStatus(watch, 'planned', true), undefined);
  assert.equal(nextStatus(watch, 'down', undefined), undefined);
});

test('watch must name a field the type has and statuses it has', () => {
  const fields = { url: { type: 'url' as const } };
  assert.deepEqual(checkCapabilities({ watch: { field: 'url', up: 'up', down: 'down' } }, fields, new Set(), ['up', 'down']), []);
  assert.match(checkCapabilities({ watch: { field: 'url', up: 'up', down: 'gone' } }, fields, new Set(), ['up', 'down']).join(), /"gone"/);
  assert.match(checkCapabilities({ watch: { field: 'where', up: 'up', down: 'down' } }, fields, new Set(), ['up', 'down']).join(), /no field/);
});

test('a monitor’s report takes a component down and back up, logged with what it said', async () => {
  const reg = new Registry(join(import.meta.dirname, '..', 'packs'));
  registries.push(reg);
  const l = new Archipelago(await openDb(), reg);
  const made = (
    (await l.change(owner, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'llm', type: 'software.component', title: 'LiteLLM', status: 'up', props: { url: 'http://litellm:4000/health/liveliness' } },
        { op: 'create', ref: 'pg', type: 'software.component', title: 'Postgres 17', status: 'up' },
        { op: 'create', ref: 'green', type: 'software.component', title: 'App, green', status: 'planned', props: { url: 'http://app-green:3100/health' } },
      ],
    })) as { created: Record<string, string> }
  ).created;
  const status = async (ref: string) => (await l.entity(made[ref]))!.status;

  // By address, from an agent token, under a policy that holds agents' changes: applied all the same.
  const down = (await callTool(l, kuma, 'health_report', beat(0, { name: 'litellm', type: 'http', url: 'http://litellm:4000/health/liveliness' }, 'connect ECONNREFUSED 172.18.0.4:4000'))) as { changed: { to: string }[] };
  assert.deepEqual(down.changed.map((c) => c.to), ['down']);
  assert.equal(await status('llm'), 'down');
  const { rows } = await l.db.query<{ reason: string; actor: string }>(`select reason, actor from event where target_id = $1 and action = 'entity.update' order by seq desc limit 1`, [made.llm]);
  assert.match(rows[0].reason, /Uptime Kuma: litellm does not answer \(connect ECONNREFUSED/);
  assert.equal(rows[0].actor, 'agent:Uptime Kuma');

  await callTool(l, kuma, 'health_report', beat(1, { name: 'litellm', type: 'http', url: 'http://litellm:4000/health/liveliness/' }, '200 - OK'));
  assert.equal(await status('llm'), 'up');

  // By title, when no item has the monitor's address.
  await callTool(l, kuma, 'health_report', beat(0, { name: 'Postgres 17', type: 'port', hostname: 'postgres', port: 5432 }, 'timeout'));
  assert.equal(await status('pg'), 'down');

  // A part not yet running is left alone; a test notification changes nothing.
  await callTool(l, kuma, 'health_report', beat(0, { name: 'App, green', type: 'http', url: 'http://app-green:3100/health' }, 'getaddrinfo ENOTFOUND'));
  assert.equal(await status('green'), 'planned');
  assert.deepEqual(await callTool(l, kuma, 'health_report', { heartbeat: null, monitor: null, msg: 'Uptime Kuma Testing...' }), { heard: true, note: 'No heartbeat: nothing to report.' });
  const { rows: proposals } = await l.db.query(`select id from proposal`);
  assert.equal(proposals.length, 0, 'nothing waits for review');
});
