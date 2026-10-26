// What comes into a pack from outside, and what it runs by itself. A webhook is a route the kernel serves at
// /hook/<pack>/<id> (or /hook/<workspace>/<pack>/<id>), checking the payload's signature with a secret it holds before
// the pack's handler sees it; a schedule is a handler entry the kernel runs every so often. Both run as the pack, an
// agent, so what they write follows the workspace's policy, and both may read from hosts but never act.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { parts } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Registry } from './packs.ts';
import { hostFor } from './packtools.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { unseal } from './secrets.ts';

const asPack = (pack: string): Actor => ({ kind: 'agent', name: `pack:${pack}` });
/** The most a webhook may carry. */
const HOOK_MAX = 1_000_000;

/** Whether a signature (sha256=<hex>) is the body's HMAC with the secret. */
export function signedWith(secret: string, body: string, signature: string | undefined): boolean {
  const want = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const got = Buffer.from(signature ?? '');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Answer a POST to /hook/... for the workspace's map (unscoped: a webhook is no one's session). */
export async function serveHook(req: IncomingMessage, res: ServerResponse, l: Archipelago, pack: string, id: string): Promise<void> {
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const file = l.registry.packs.find((p) => p.id === pack);
  const hook = file && parts(file).webhooks.find((w) => w.id === id);
  // Gone, as the contract says, when the pack is off or does not declare it.
  if (!hook) return reply(410, { error: `No webhook ${pack}/${id} here.` });
  if (Number(req.headers['content-length'] ?? 0) > HOOK_MAX) return reply(413, { error: 'Too large.' });
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > HOOK_MAX) return reply(413, { error: 'Too large.' });
  }
  const { rows } = await l.db.query<{ value: string | null }>(`select pelago_pack_secret($1) as value`, [`pack_secret:${pack}:${hook.secret}`]);
  const secret = unseal(rows[0]?.value);
  const signature = req.headers[(hook.header ?? 'x-signature-256').toLowerCase()];
  if (!secret || !signedWith(secret, body, typeof signature === 'string' ? signature : undefined)) return reply(401, { error: 'The signature does not match.' });
  let payload: unknown = body;
  try {
    payload = JSON.parse(body);
  } catch {
    // Not JSON: the handler is given the text.
  }
  // What the delivery is, as its sender says in its headers: only those the webhook declares.
  const headers = Object.fromEntries(['content-type', ...(hook.headers ?? [])].map((name) => [name, req.headers[name]]).filter(([, v]) => typeof v === 'string'));
  try {
    const done = await runHook(l, pack, id, { payload, headers });
    return reply(200, { ok: true, ...('status' in done && { status: done.status }), ...(done.answer !== null && { answer: done.answer }) });
  } catch (err) {
    return reply(500, { error: (err as Error).message });
  }
}

/** Hand a delivery the kernel has already checked to a pack's webhook entry, run as the pack. */
export function runHook(l: Archipelago, pack: string, id: string, input: { payload: unknown; headers: Record<string, unknown> }) {
  return hostFor(l.registry).act(l, asPack(pack), pack, id, input, undefined, 'webhook');
}

/** Ask a pack's webhook entry what it makes of a delivery, as the pack: it writes nothing and records nothing. */
export async function askHook(l: Archipelago, pack: string, id: string, input: { payload: unknown; headers: Record<string, unknown> }) {
  return (await hostFor(l.registry).call(l, asPack(pack), pack, 'webhook', id, input)).answer ?? null;
}

/** The pack that records a kind of event from a webhook of its own, and that webhook: who takes it in, where the kernel hears of it first. */
export function hookFor(l: Archipelago, event: string): { pack: string; hook: string; secret: string } | undefined {
  const file = l.registry.packs.find((p) => parts(p).events.includes(event) && parts(p).webhooks.length);
  return file && { pack: file.id, hook: parts(file).webhooks[0].id, secret: parts(file).webhooks[0].secret };
}

/** Run one schedule now, as the pack. */
export function runSchedule(l: Archipelago, pack: string, id: string) {
  const limit = parts(l.registry.packs.find((p) => p.id === pack) ?? { id: pack, version: '', title: '' }).schedules.find((s) => s.id === id)?.limit_ms;
  return hostFor(l.registry).act(l, asPack(pack), pack, id, {}, limit, 'schedule');
}

const timers = new WeakMap<Registry, NodeJS.Timeout>();

/**
 * Run the schedules of a workspace's active packs when each is due, and those that say at_start once on the first
 * tick. One clock a minute reads the registry as it is, so a pack turned off stops running and one turned on starts,
 * with nothing to restart.
 */
export function startSchedules(l: Archipelago): void {
  stopSchedules(l.registry);
  const last = new Map<string, number>();
  const started = Date.now();
  const tick = () => {
    for (const pack of l.registry.packs)
      for (const s of parts(pack).schedules) {
        const key = `${pack.id}/${s.id}`;
        const first = s.at_start && !last.has(key);
        if (!first && (s.every_minutes === undefined || Date.now() - (last.get(key) ?? started) < s.every_minutes * 60_000)) continue;
        last.set(key, Date.now());
        void runSchedule(l, pack.id, s.id).catch((err) => console.error(`schedule ${key}: ${(err as Error).message}`));
      }
  };
  timers.set(l.registry, setInterval(tick, 60_000).unref());
}

export function stopSchedules(reg: Registry): void {
  clearInterval(timers.get(reg));
  timers.delete(reg);
}
