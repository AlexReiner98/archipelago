// Identity. A token says who is calling and which workspace they belong to;
// what they may do follows from whether the token is a human's or an agent's.
// Tokens live in their workspace's own database, stored only as a hash.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { newId, type Q } from './db.ts';
import type { Actor } from './lattice.ts';

export interface Identity {
  /** Carries the token's person, admin flag and id along with kind and name. */
  actor: Actor;
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
}

const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const validWorkspaceId = (id: string) => WORKSPACE_ID.test(id);

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Which workspace a token claims to be for. Says nothing about whether it is valid. */
export function workspaceOf(token: string): string | undefined {
  const match = /^lat_([a-z0-9][a-z0-9-]{0,39})_[a-f0-9]{40}$/.exec(token);
  return match?.[1];
}

export function bearer(header: string | undefined): string | undefined {
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

/** Make a token. The secret is returned once and cannot be recovered. */
export async function createToken(db: Q, workspace: string, input: { kind: 'human' | 'agent'; name: string; entity?: string; expires_days?: number; admin?: boolean }) {
  if (!validWorkspaceId(workspace)) throw new Error(`Invalid workspace id "${workspace}"`);
  if (!input.name.trim()) throw new Error('A token needs a name: who or what will use it.');
  const token = `lat_${workspace}_${randomBytes(20).toString('hex')}`;
  const id = newId('k');
  await db.query(
    `insert into token (id, hash, hint, kind, name, entity_id, admin, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, case when $8::int is null then null else now() + ($8::int || ' days')::interval end)`,
    [id, hash(token), `…${token.slice(-6)}`, input.kind, input.name.trim(), input.entity ?? null, Boolean(input.admin) && input.kind === 'human', input.expires_days ?? null],
  );
  return { id, token, kind: input.kind, name: input.name.trim(), note: 'Keep this token now: it is not stored and cannot be shown again.' };
}

export async function verifyToken(db: Q, token: string): Promise<Identity | undefined> {
  const { rows } = await db.query<{ id: string; hash: string; kind: 'human' | 'agent'; name: string; entity_id: string | null; admin: boolean }>(
    `select id, hash, kind, name, entity_id, admin from token where hash = $1 and revoked_at is null and (expires_at is null or expires_at > now())`,
    [hash(token)],
  );
  const row = rows[0];
  if (!row || !timingSafeEqual(Buffer.from(row.hash), Buffer.from(hash(token)))) return undefined;
  await db.query(`update token set last_used = now() where id = $1`, [row.id]);
  return { actor: { kind: row.kind, name: row.name, person: row.entity_id ?? undefined, admin: row.admin, token: row.id } };
}

/** Every token, or only those belonging to one person. */
export async function listTokens(db: Q, person?: string): Promise<TokenInfo[]> {
  const { rows } = await db.query<TokenInfo>(
    `select id, kind, name, entity_id, hint, admin, created_at, last_used, expires_at, revoked_at from token where $1::text is null or entity_id = $1 order by created_at`,
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
/** Written by `lattice operator-reset`, in the folder that holds the workspaces. */
export const OPERATOR_RESET_FILE = 'operator-reset';
export const newSecret = (prefix: string) => `${prefix}_${randomBytes(24).toString('hex')}`;
export function sameSecret(given: string, expectedHash: string): boolean {
  const a = Buffer.from(hash(given));
  const b = Buffer.from(expectedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
