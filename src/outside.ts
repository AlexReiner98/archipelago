// What a pack asks to have done outside the map. Its handler never calls out: it answers requests to hosts its pack
// declared, and the kernel makes them, adding the secret it holds (the pack never sees it). A request that reads is
// made at once. A request to act must be one its action declared; one that moves money or cannot be taken back waits
// for a person, and is made once they say so. Every act is logged and never undone. A request may name a handler
// entry to be told the answer (then), which answers ops in turn.

import { newSecret } from './auth.ts';
import { parts } from './manifest.ts';
import { newId } from './db.ts';
import type { ActionDef, HostDef } from './declared.ts';
import { notify } from './notify.ts';
import type { Done, PackHost } from './packhost.ts';
import type { PackFile } from './packs.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import { seal, unseal } from './secrets.ts';

export interface OutsideRequest {
  host: string;
  method?: string;
  /** Under the host's base address. */
  path: string;
  body?: unknown;
  /** The act it is, when it does something rather than read. */
  act?: string;
  /** The handler entry told the answer. */
  then?: string;
}

export interface Outcome {
  host: string;
  act?: string;
  status: 'made' | 'held' | 'refused' | 'failed';
  id?: string;
  http?: number;
  why?: string;
}

/** How deep answers may lead to further requests. */
const DEPTH = 3;
const TIMEOUT_MS = 10_000;

const secretKey = (pack: string, name: string) => `pack_secret:${pack}:${name}`;

/**
 * Keep a secret a pack's host or webhook needs, sealed. The owner's. With make, the kernel makes it (a webhook's, which
 * the sender is then given) and shows it this once.
 */
export async function setPackSecret(l: Archipelago, input: { pack: string; name: string; value?: string; make?: boolean }) {
  const value = input.make ? newSecret(input.pack.slice(0, 8)) : input.value;
  if (!value) throw new Error('Give the secret, or make one.');
  await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = $2::jsonb`, [secretKey(input.pack, input.name), JSON.stringify(seal(value))]);
  return { kept: secretKey(input.pack, input.name), ...(input.make && { secret: value }) };
}

/** Whether the owner has given a pack this secret. */
export async function hasPackSecret(l: Archipelago, pack: string, name: string): Promise<boolean> {
  const { rows } = await l.db.query<{ value: string | null }>(`select pelago_pack_secret($1) as value`, [secretKey(pack, name)]);
  return Boolean(unseal(rows[0]?.value));
}

/** Make one request to a declared host, with its secret. */
async function make(l: Archipelago, pack: string, host: HostDef, r: OutsideRequest): Promise<{ http: number; body: unknown }> {
  const base = new URL(host.base.endsWith('/') ? host.base : `${host.base}/`);
  const url = new URL(r.path.replace(/^\/+/, ''), base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error(`${r.path} is outside the host ${host.id}`);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (r.body !== undefined) headers['content-type'] = 'application/json';
  if (host.secret) {
    const { rows } = await l.db.query<{ value: string | null }>(`select pelago_pack_secret($1) as value`, [secretKey(pack, host.secret)]);
    const secret = unseal(rows[0]?.value);
    if (!secret) throw new Error(`The owner has not given the ${pack} pack its secret "${host.secret}"`);
    const header = (host.header ?? 'authorization').toLowerCase();
    headers[header] = header === 'authorization' ? `Bearer ${secret}` : secret;
  }
  const res = await fetch(url, { method: r.method ?? (r.body === undefined ? 'GET' : 'POST'), headers, body: r.body === undefined ? undefined : JSON.stringify(r.body), signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: the handler is given the text.
  }
  return { http: res.status, body };
}

/** Tell the handler what came back, and apply what it answers. */
async function answer(host: PackHost, l: Archipelago, actor: Actor, pack: PackFile, r: OutsideRequest, made: { http: number; body: unknown }, depth: number): Promise<Outcome[]> {
  if (!r.then) return [];
  const done: Done = await host.call(l, actor, pack.id, 'answer', r.then, { request: r, status: made.http, body: made.body });
  const changed = done.ops?.length ? await l.change(actor, { ops: done.ops, reason: done.reason?.trim() || `${pack.id}: ${r.then}`, action: `${pack.id}.${r.then}` }) : undefined;
  return done.requests?.length && depth < DEPTH ? handleRequests(host, l, actor, pack, undefined, done.requests, (changed as { changeset?: string } | undefined)?.changeset, depth + 1) : [];
}

/** Make, hold or refuse what a handler asked for. `action` is the action it came from; only an action may act. */
export async function handleRequests(host: PackHost, l: Archipelago, actor: Actor, pack: PackFile, action: ActionDef | undefined, requests: OutsideRequest[], changeset: string | undefined, depth = 0): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const r of requests) {
    const target = parts(pack).hosts.find((h) => h.id === r.host);
    if (!target) {
      out.push({ host: r.host, status: 'refused', why: `the ${pack.id} pack declares no host "${r.host}"` });
      continue;
    }
    if (!r.act) {
      try {
        const made = await make(l, pack.id, target, r);
        out.push({ host: r.host, status: 'made', http: made.http }, ...(await answer(host, l, actor, pack, r, made, depth)));
      } catch (err) {
        out.push({ host: r.host, status: 'failed', why: (err as Error).message });
      }
      continue;
    }
    const declared = action?.acts?.find((a) => a.id === r.act && a.host === r.host);
    if (!declared) {
      out.push({ host: r.host, act: r.act, status: 'refused', why: `${action ? `"${action.id}"` : 'only an action'} declares no act "${r.act}" on ${r.host}` });
      continue;
    }
    const id = newId('a');
    const held = Boolean(declared.money || declared.final);
    await l.db.query(
      `insert into act (id, workspace, pack, action, act, request, actor, made_for, changeset, status) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, 'held')`,
      [id, l.workspace, pack.id, action!.id, r.act, JSON.stringify(r), JSON.stringify({ kind: actor.kind, name: actor.name }), l.viewer || null, changeset ?? null],
    );
    if (held) {
      await notify(l, { kind: 'agent', name: `pack:${pack.id}` }, { title: `${pack.title} asks to ${declared.does}`, body: `Held for you because it ${declared.money ? 'moves money' : 'cannot be taken back'}: act ${id}. Allow it with act_decide.`, level: 'warning' });
      out.push({ host: r.host, act: r.act, status: 'held', id });
    } else out.push(...(await makeAct(host, l, actor, pack, id, r, depth)));
  }
  return out;
}

/** Make an act now, log it as done (never undone), and tell the handler. */
async function makeAct(host: PackHost, l: Archipelago, actor: Actor, pack: PackFile, id: string, r: OutsideRequest, depth: number): Promise<Outcome[]> {
  const target = parts(pack).hosts.find((h) => h.id === r.host)!;
  try {
    const made = await make(l, pack.id, target, r);
    await l.db.query(`update act set status = 'done', result = $2::jsonb, decided_at = now() where id = $1`, [id, JSON.stringify({ http: made.http })]);
    await l.log(l.db, { actor: actorId(actor), action: 'act.done', reason: `${pack.id}: ${r.act}`, detail: { act: id, pack: pack.id, does: r.act, host: r.host, http: made.http } });
    return [{ host: r.host, act: r.act, status: 'made', id, http: made.http }, ...(await answer(host, l, actor, pack, r, made, depth))];
  } catch (err) {
    await l.db.query(`update act set status = 'failed', result = $2::jsonb, decided_at = now() where id = $1`, [id, JSON.stringify({ error: (err as Error).message })]);
    return [{ host: r.host, act: r.act, status: 'failed', id, why: (err as Error).message }];
  }
}

/** A person allows a held act, which is then made, or declines it. */
export async function decideAct(host: PackHost, l: Archipelago, actor: Actor, input: { act: string; allow: boolean }) {
  if (actor.kind !== 'human') throw new Error('Only a person allows an act that is held.');
  const { rows } = await l.db.query<{ pack: string; request: OutsideRequest; actor: Actor; status: string }>(`select pack, request, actor, status from act where id = $1`, [input.act]);
  const row = rows[0];
  if (!row) throw new Error(`No act "${input.act}"`);
  if (row.status !== 'held') throw new Error(`Act ${input.act} is ${row.status}, not held`);
  const pack = l.registry.packs.find((p) => p.id === row.pack);
  if (!pack) throw new Error(`The ${row.pack} pack is not active, so its act cannot be made now`);
  if (!input.allow) {
    await l.db.query(`update act set status = 'refused', decided_at = now() where id = $1`, [input.act]);
    await l.log(l.db, { actor: actorId(actor), action: 'act.refused', reason: `${row.pack}: ${row.request.act}`, detail: { act: input.act } });
    return [{ host: row.request.host, act: row.request.act, status: 'refused' as const, id: input.act }];
  }
  return makeAct(host, l, row.actor, pack, input.act, row.request, 0);
}

/** Acts held for a person, newest first, and the latest made. */
export async function listActs(l: Archipelago) {
  const { rows } = await l.db.query(`select id, pack, action, act, request->>'host' as host, status, created_at, decided_at from act order by status = 'held' desc, created_at desc limit 50`);
  return rows;
}
