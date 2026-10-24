// What a pack has done outside the map, through the kernel: reads from a host it declared with a secret it never
// sees, an act held for a person and made once allowed, a webhook checked by its signature, a schedule, and an undo
// that says which acts it could not reach.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../src/db.ts';
import { runSchedule, serveHook } from '../src/hooks.ts';
import { decideAct, setPackSecret, type Outcome } from '../src/outside.ts';
import { hostFor } from '../src/packtools.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { readEvents } from '../src/eventlog.ts';
import { undo } from '../src/undo.ts';

const human: Actor = { kind: 'human', name: 'test' };
const closers: (() => unknown)[] = [];
after(() => closers.forEach((c) => c()));

/** The shop outside: its price list, orders and notes, and what it was sent. */
async function shop() {
  const seen: { method: string; path: string; auth?: string; body: string }[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method!, path: req.url!, auth: req.headers.authorization, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/api/prices' ? { flour: 2, salt: 1 } : req.url === '/api/orders' ? { order: 'O-1' } : { ok: true }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => server.close());
  return { seen, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/` };
}

async function map(base: string) {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-outside-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  cpSync(join(import.meta.dirname, 'packs', 'demo'), join(dir, 'demo'), { recursive: true });
  const file = join(dir, 'demo', 'pack.json');
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  pack.reach.hosts[0].base = base;
  writeFileSync(file, JSON.stringify(pack));
  const reg = new Registry(dir);
  closers.push(() => hostFor(reg).stop());
  const l = new Archipelago(await openDb(), reg, { create: 'auto', update: 'auto', link: 'auto' });
  await setPackSecret(l, { pack: 'demo', name: 'shop_key', value: 's3cret' });
  await setPackSecret(l, { pack: 'demo', name: 'hook_key', value: 'h00k' });
  return l;
}

const titles = async (l: Archipelago) => (await l.db.query<{ title: string }>(`select title from entity where type = 'work.note' order by created_at`)).rows.map((r) => r.title);

test('a read is made at once with the secret; an act that moves money waits for a person; undo says what it could not reach', async () => {
  const { seen, base } = await shop();
  const l = await map(base);
  const host = hostFor(l.registry);
  const done = (await host.act(l, human, 'demo', 'demo.order', { item: 'flour', peek: 'nowhere' })) as { changeset: string; requests: Outcome[] };
  const [read, buy, note, peek] = done.requests;
  assert.deepEqual([read.status, read.http], ['made', 200]);
  assert.deepEqual([buy.act, buy.status], ['buy', 'held']);
  assert.deepEqual([note.act, note.status], ['note', 'made']);
  assert.equal(peek.status, 'refused', 'a host the pack did not declare is refused');
  assert.deepEqual(seen.map((s) => `${s.method} ${s.path}`), ['GET /api/prices', 'POST /api/notes'], 'nothing bought yet');
  assert.ok(seen.every((s) => s.auth === 'Bearer s3cret'), 'the kernel added the secret');
  assert.deepEqual(await titles(l), ['Prices: flour, salt'], 'the answer was told to the handler, which wrote it');
  const { rows: told } = await l.db.query<{ title: string }>(`select title from entity where type = 'sys.notification'`);
  assert.match(told[0].title, /Demo asks to buy supplies/);

  await assert.rejects(decideAct(host, l, { kind: 'agent', name: 'a' }, { act: buy.id!, allow: true }), /Only a person/);
  const allowed = await decideAct(host, l, human, { act: buy.id!, allow: true });
  assert.equal(allowed[0].status, 'made');
  assert.equal(seen.at(-1)!.path, '/api/orders');
  assert.ok((await titles(l)).includes('Bought, order O-1'));
  await assert.rejects(decideAct(host, l, human, { act: buy.id!, allow: true }), /is done, not held/);

  const undone = (await undo(l, human, { changeset: done.changeset })) as { skipped: string[] };
  assert.equal(undone.skipped.filter((s) => /cannot be undone/.test(s)).length, 2, 'the buy and the note were made outside the map');
});

test('a webhook is taken only with its signature, and a schedule runs as the pack', async () => {
  const { base } = await shop();
  const l = await map(base);
  const server = createServer((req: IncomingMessage, res) => void serveHook(req, res, l, 'demo', req.url!.slice(1)));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const body = JSON.stringify({ item: 'flour' });
  const sign = (secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal((await fetch(`${url}/demo.delivered`, { method: 'POST', body, headers: { 'x-signature-256': sign('wrong') } })).status, 401);
  assert.equal((await fetch(`${url}/demo.nothing`, { method: 'POST', body })).status, 410);
  const ok = await fetch(`${url}/demo.delivered`, { method: 'POST', body, headers: { 'x-signature-256': sign('h00k') } });
  assert.equal(ok.status, 200);
  assert.ok((await titles(l)).includes('Delivered: flour'));
  const rows = await readEvents(l.db, { action: 'entity.create', limit: 1 });
  assert.match(rows[0].actor, /pack:demo/);
  const { rows: arrived } = await l.db.query<{ actor: string; reason: string; detail: { pack?: string } }>(`select actor, reason, detail from event where action = 'demo.arrived'`);
  assert.deepEqual(arrived.map((e) => [e.actor, e.reason, e.detail.pack]), [['agent:pack:demo', 'flour arrived', 'demo']], 'an event of a kind it declares, recorded as the pack');
  const stray = await fetch(`${url}/demo.delivered`, { method: 'POST', body, headers: { 'x-signature-256': sign('h00k'), 'x-demo-kind': 'stray' } });
  assert.equal(stray.status, 500);
  assert.match(((await stray.json()) as { error: string }).error, /declares no event "demo.stray"/, 'given the header it declares, and refused an event it does not');
  assert.equal((await titles(l)).filter((t) => t === 'Delivered: flour').length, 1, 'and nothing it answered is written');

  const ran = (await runSchedule(l, 'demo', 'demo.tick')) as { requests: Outcome[] };
  assert.equal(ran.requests[0].status, 'made');
});
