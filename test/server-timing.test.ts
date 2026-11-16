// Every /api and /agent answer says where its time went (src/timing.ts): its statements and the wall time they took,
// its waits for a transaction, its calls into pack code, the rest (app) and the whole, as a Server-Timing header the
// browser's network panel and curl show.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../packs/identity/kernel/auth.ts';
import { serve } from './serve.ts';

const PART = /^(db|wait|pack|app|total);dur=(\d+\.\d)(?:;desc="(\d+) (?:statements, \d+ ms summed|transactions|calls)")?$/;

/** The header's parts by name: their ms, and the count each describes. */
function parts(header: string | null) {
  assert.ok(header, 'the answer has a Server-Timing header');
  const out: Record<string, { dur: number; count?: number }> = {};
  for (const part of header.split(/, (?=[a-z]+;)/)) { // a description may hold a comma: it is quoted
    const m = PART.exec(part);
    assert.ok(m, `"${part}" is a part of the header's shape`);
    out[m[1]] = { dur: Number(m[2]), ...(m[3] !== undefined && { count: Number(m[3]) }) };
  }
  assert.deepEqual(Object.keys(out), ['db', 'wait', 'pack', 'app', 'total']);
  return out;
}

test('an answer of /api and /agent carries where its time went; other addresses do not', async () => {
  const { base, call, workspaces } = await serve('tokens');
  const token = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const made = (await call('/api/change', token, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'task', title: 'Pour the slab' }] })).result.created as Record<string, string>;
  const ask = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

  const from = performance.now();
  const got = await ask('/api/query', { name: 'get', params: { id: made.a } });
  const outside = performance.now() - from;
  assert.equal(got.status, 200);
  const header = got.headers.get('server-timing'), t = parts(header);
  assert.ok(t.db.count! > 0 && t.db.dur > 0, `a read runs statements: ${header}`);
  assert.ok(t.wait.count! > 0, `a person's statements run in transactions: ${header}`);
  // The parts add up: db and app make the whole, which is no longer than the request timed from outside.
  assert.ok(Math.abs(t.app.dur + t.db.dur - t.total.dur) <= 0.15, `db and app make the whole: ${header}`);
  // The waits are summed: transactions asked side by side wait at once, so they may add up past the whole.
  assert.ok(t.db.dur <= t.total.dur && t.pack.dur <= t.total.dur, `db and pack are within the whole: ${header}`);
  assert.ok(t.total.dur <= outside + 0.1, `the whole (${t.total.dur} ms) is within the time seen from outside (${outside.toFixed(1)} ms)`);
  await got.text();

  const agent = await ask('/agent/query', { name: 'search', params: { q: 'slab' } });
  assert.equal(agent.status, 200);
  assert.ok(parts(agent.headers.get('server-timing')).db.count! > 0, 'an agent call says it too');
  await agent.text();

  const refused = await ask('/api/query', { name: 'no such read' });
  assert.equal(refused.status, 400);
  parts(refused.headers.get('server-timing')); // an error too
  await refused.text();

  const health = await fetch(`${base}/health`);
  assert.equal(health.headers.get('server-timing'), null, 'what is not /api or /agent is not timed');
  await health.text();
});
