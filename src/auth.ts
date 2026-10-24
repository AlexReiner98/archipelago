// Identity. A token says who is calling and which workspace they belong to;
// what they may do follows from whether the token is a human's or an agent's,
// and for an agent's from its scope: within which items it writes, and whether
// it may report, propose or change. Tokens live in their workspace's own
// database, stored only as a hash.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { newId, type Db, type Q } from './db.ts';
import { record } from './streams.ts';
import type { Actor, May } from './pelago.ts';

export interface Identity {
  /** Carries the token's person, admin flag and id along with kind and name. */
  actor: Actor;
  /** Set when the token has just been used from a network it had not been used from before. */
  newPlace?: string;
}

export interface TokenInfo {
  id: string;
  kind: 'human' | 'agent';
  name: string;
  entity_id: string | null;
  hint: string;
  admin: boolean;
  created_at: Date;
  last_used: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  /** The items it writes within (and what is part of them); null for everything. */
  within: string[] | null;
  /** What it may do: send reports, propose changes, or change as any agent does. */
  may: May;
  /** The addresses it has been used from, each cut to its network. */
  seen: string[] | null;
}

/**
 * An address cut down to the network it is on, so a machine whose address
 * moves within its network is one place and not many: the first three parts
 * of an IPv4 address, the first three groups of an IPv6 one.
 */
export function network(address: string | undefined): string | undefined {
  const a = (address ?? '').trim().replace(/^::ffff:/, '');
  if (!a) return undefined;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) return `${a.split('.').slice(0, 3).join('.')}.x`;
  return a.includes(':') ? `${a.split(':').slice(0, 3).join(':')}::` : a;
}

const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const validWorkspaceId = (id: string) => WORKSPACE_ID.test(id);

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Which workspace a token claims to be for. Says nothing about whether it is valid. One made while this was called Lattice begins lat_. */
export function workspaceOf(token: string): string | undefined {
  const match = /^(?:pel|lat)_([a-z0-9][a-z0-9-]{0,39})_[a-f0-9]{40}$/.exec(token);
  return match?.[1];
}

export function bearer(header: string | undefined): string | undefined {
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

/** Make a token. The secret is returned once and cannot be recovered. */
export async function createToken(db: Q, workspace: string, input: { kind: 'human' | 'agent'; name: string; entity?: string; expires_days?: number; admin?: boolean; within?: string[]; may?: May }) {
  if (!validWorkspaceId(workspace)) throw new Error(`Invalid workspace id "${workspace}"`);
  if (!input.name.trim()) throw new Error('A token needs a name: who or what will use it.');
  const token = `pel_${workspace}_${randomBytes(20).toString('hex')}`;
  const id = newId('k');
  const agent = input.kind === 'agent';
  const within = agent && input.within?.length ? JSON.stringify(input.within) : null;
  // repos is written beside within for the commit before this one, which reads only repos, while both run.
  await db.query(
    `insert into token (id, hash, hint, kind, name, entity_id, admin, expires_at, within, repos, may)
     values ($1, $2, $3, $4, $5, $6, $7, case when $8::int is null then null else now() + ($8::int || ' days')::interval end, $9::jsonb, $9::jsonb, $10)`,
    [id, hash(token), `…${token.slice(-6)}`, input.kind, input.name.trim(), input.entity ?? null, Boolean(input.admin) && !agent, input.expires_days ?? null, within, agent ? (input.may ?? 'change') : 'change'],
  );
  return { id, token, kind: input.kind, name: input.name.trim(), note: 'Keep this token now: it is not stored and cannot be shown again.' };
}

/**
 * Who a token is. Given the address the request came from, it also keeps
 * where the token has been used, and says when this is somewhere new: a
 * token copied off a machine shows up as a place its owner does not know.
 * The first place a token is used is not news.
 */
export async function verifyToken(db: Db, token: string, from?: string, ws = 'default'): Promise<Identity | undefined> {
  const { rows } = await db.query<{ id: string; hash: string; kind: 'human' | 'agent'; name: string; entity_id: string | null; admin: boolean; within: string[] | null; may: May; seen: string[] | null; last_used: Date | null }>(
    `select id, hash, kind, name, entity_id, admin, within, coalesce(may, 'change') as may, seen, last_used from token where hash = $1 and revoked_at is null and (expires_at is null or expires_at > now())`,
    [hash(token)],
  );
  const row = rows[0];
  if (!row || !timingSafeEqual(Buffer.from(row.hash), Buffer.from(hash(token)))) return undefined;
  const place = network(from);
  const seen = row.seen ?? [];
  const fresh = place !== undefined && !seen.includes(place);
  // The last twenty places are kept: enough to know a machine by, and a list that cannot grow without end.
  await db.query(`update token set last_used = now(), seen = $2::jsonb where id = $1`, [row.id, JSON.stringify(fresh ? [...seen, place].slice(-20) : seen)]);
  // Its use is in the access stream at most once an hour: how recently, not every request.
  if (!row.last_used || Date.now() - new Date(row.last_used).getTime() >= 3600_000) await db.transaction((tx) => record(tx, ws, 'access', row.id, [['+', row.id, 'last_used', new Date().toISOString()]]));
  return {
    actor: { kind: row.kind, name: row.name, person: row.entity_id ?? undefined, admin: row.admin, token: row.id, ...(row.within?.length && { within: row.within }), ...(row.may !== 'change' && { may: row.may }) },
    ...(fresh && seen.length > 0 && { newPlace: place }),
  };
}

/** Every token, or only those belonging to one person. */
export async function listTokens(db: Q, person?: string): Promise<TokenInfo[]> {
  const { rows } = await db.query<TokenInfo>(
    `select id, kind, name, entity_id, hint, admin, created_at, last_used, expires_at, revoked_at, within, coalesce(may, 'change') as may, seen from token where $1::text is null or entity_id = $1 order by created_at`,
    [person ?? null],
  );
  return rows;
}

/** Revoke a token; with a person given, only if it is theirs. */
export async function revokeToken(db: Q, id: string, person?: string) {
  const { rows } = await db.query<{ name: string }>(
    `update token set revoked_at = now() where id = $1 and revoked_at is null and ($2::text is null or entity_id = $2) returning name`,
    [id, person ?? null],
  );
  if (!rows.length) throw new Error(`No active token "${id}"`);
  return { revoked: id, name: rows[0].name };
}

export async function hasHumanToken(db: Q): Promise<boolean> {
  const { rows } = await db.query(`select 1 from token where kind = 'human' and revoked_at is null and (expires_at is null or expires_at > now()) limit 1`);
  return rows.length > 0;
}

/** For the one secret kept outside any workspace: the operator's. */
export const hashSecret = hash;
/** Written by `pelago operator-reset`, in the folder that holds the workspaces. */
export const OPERATOR_RESET_FILE = 'operator-reset';
export const newSecret = (prefix: string) => `${prefix}_${randomBytes(24).toString('hex')}`;
export function sameSecret(given: string, expectedHash: string): boolean {
  const a = Buffer.from(hash(given));
  const b = Buffer.from(expectedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
