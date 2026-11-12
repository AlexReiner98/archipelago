// A person's agent token: one token that reaches every workspace its person is a member of, acting in each as that
// person's member record there, so it sees what is private to them (the owner, 9 Nov 2026, bug e_94ag6443: "the one
// token should just give you all the same access as me"). A person across workspaces is the same sign-in address, so
// the token holds the addresses it acts for, and each call names its workspace; one named none goes to the token's home.
//
// It belongs to no workspace, so it is kept in the server's own database (control values, src/control.ts), only as a
// hash, beside the indexes of src/control-index.ts. Membership is asked on every call: a member removed is cut off
// there at once, with nothing to revoke. It is always an agent's and never an admin's; what it changes is judged by each
// workspace's own rules, as any agent's is.

import { randomBytes } from 'node:crypto';
import { newId, type Q } from '../../database/kernel/db.ts';
import { sameBytes, sha256Hex } from '../../../src/hashes.ts';
import { controlDb } from './control-index.ts';
import { memberOf } from './members.ts';
import type { Actor, May } from '../../write/kernel/pelago.ts';

export interface PersonToken {
  id: string;
  name: string;
  /** The sign-in addresses it acts for: in a workspace, the member at one of these. */
  emails: string[];
  /** Where a call that names no workspace goes: the workspace it was made in. */
  home: string;
  may: May;
  created_at: string;
  expires_at: string | null;
  last_used: string | null;
  revoked_at: string | null;
}

const SHAPE = /^pep_[a-f0-9]{48}$/;
/** Whether a secret is a person token's (it names no workspace). */
export const isPersonToken = (token: string | undefined): token is string => Boolean(token && SHAPE.test(token));

const byHash = (hash: string) => `person_token:${hash}`;
const byId = (id: string) => `person_token_id:${id}`;
const ofEmail = (email: string) => `person_tokens_of:${email}`;

async function control(): Promise<Q> {
  const c = await controlDb();
  if (!c) throw new Error('This server keeps no person tokens.');
  return c;
}
const read = async <T>(c: Q, key: string) => (await c.query<{ value: T }>(`select value from control_value where key = $1`, [key])).rows[0]?.value;
const write = (c: Q, key: string, value: unknown) => c.query(`insert into control_value (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
async function addTo(c: Q, email: string, id: string) {
  const ids = (await read<string[]>(c, ofEmail(email))) ?? [];
  if (!ids.includes(id)) await write(c, ofEmail(email), [...ids, id]);
}
const live = (t: PersonToken) => !t.revoked_at && (!t.expires_at || Date.parse(t.expires_at) > Date.now());

/** Make a person token for an address, at home in a workspace. The secret is returned once and cannot be recovered. */
export async function createPersonToken(input: { name: string; email: string; home: string; may?: May; expires_days?: number }) {
  if (!input.name.trim()) throw new Error('A token needs a name: who or what will use it.');
  const c = await control();
  const token = `pep_${randomBytes(24).toString('hex')}`;
  const hash = sha256Hex(token);
  const made: PersonToken = {
    id: newId('k'),
    name: input.name.trim(),
    emails: [input.email],
    home: input.home,
    may: input.may ?? 'change',
    created_at: new Date().toISOString(),
    expires_at: input.expires_days === undefined ? null : new Date(Date.now() + input.expires_days * 86_400_000).toISOString(),
    last_used: null,
    revoked_at: null,
  };
  await write(c, byHash(hash), made);
  await write(c, byId(made.id), hash);
  await addTo(c, input.email, made.id);
  return { id: made.id, token, kind: 'agent' as const, name: made.name, everywhere: true, emails: made.emails, home: made.home, note: 'Keep this token now: it is not stored and cannot be shown again. It reaches every workspace you are a member of; name one per call (the workspace input, or the x-pelago-workspace header).' };
}

/** The live person token a secret is, if any. */
export async function personToken(token: string): Promise<PersonToken | undefined> {
  if (!isPersonToken(token)) return undefined;
  const c = await controlDb();
  if (!c) return undefined;
  const hash = sha256Hex(token);
  const found = await read<PersonToken>(c, byHash(hash));
  if (!found || !live(found) || !sameBytes(hash, (await read<string>(c, byId(found.id))) ?? '')) return undefined;
  // How recently, not every request: at most once a minute.
  if (!found.last_used || Date.now() - Date.parse(found.last_used) > 60_000) await write(c, byHash(hash), { ...found, last_used: new Date().toISOString() });
  return found;
}

/** A person merged into another acts as that other, as a workspace token's person does (src/auth.ts). */
async function kept(db: Q, person: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select coalesce((select f.value #>> '{}' from log_fact f join entity e on e.id = f.id and e.archived_at is not null
       where f.stream = 'facts' and f.id = $1 and f.field = 'merged_into' order by f.pos desc limit 1 -- index log_fact_history
     ), $1) as id`,
    [person],
  );
  return rows[0]?.id ?? person;
}

/**
 * Who a person token is in one workspace, given that workspace's whole database: the member at one of its addresses,
 * as an agent, never an admin. Undefined where none of its addresses is a member.
 */
export async function actingIn(db: Q, found: PersonToken): Promise<Actor | undefined> {
  for (const email of found.emails) {
    const member = await memberOf(db, email);
    // A member who only reads is held to reading by their person token too.
    if (member) return { kind: 'agent', name: found.name, person: await kept(db, member.person_id), admin: false, token: found.id, ...(member.read_only ? { may: 'read' as const } : found.may !== 'change' && { may: found.may }) };
  }
  return undefined;
}

/**
 * Who a person token's secret is in the workspace a call names (else its home), given how to open a workspace's whole
 * database: undefined when the token is no good, the workspace does not exist, or none of its addresses is a member.
 */
export async function personAt(token: string, named: () => Promise<string | undefined>, dbOf: (workspace: string) => Promise<Q | undefined>): Promise<{ workspace: string; actor: Actor } | undefined> {
  const found = await personToken(token);
  const workspace = found && ((await named()) || found.home); // what a call names is read once its token is known good
  const db = workspace && (await dbOf(workspace));
  const actor = db && (await actingIn(db, found!));
  return actor ? { workspace: workspace as string, actor } : undefined;
}

/**
 * Let a person token reach a workspace by another of its person's addresses: whoever holds the token and is signed in
 * there at that address is that person, both times.
 */
export async function extendPersonToken(token: string, email: string) {
  const found = await personToken(token);
  if (!found) throw new Error('That is no live person token.');
  const c = await control();
  if (!found.emails.includes(email)) await write(c, byHash(sha256Hex(token)), { ...found, emails: [...found.emails, email] });
  await addTo(c, email, found.id);
  return { id: found.id, name: found.name, emails: found.emails.includes(email) ? found.emails : [...found.emails, email] };
}

/** The person tokens acting for any of these addresses: a person's own, or those reaching a workspace's members. */
export async function personTokensOf(emails: string[]): Promise<PersonToken[]> {
  const c = await controlDb();
  if (!c) return [];
  const ids = new Set<string>();
  for (const email of emails) for (const id of (await read<string[]>(c, ofEmail(email))) ?? []) ids.add(id);
  const out: PersonToken[] = [];
  for (const id of ids) {
    const hash = await read<string>(c, byId(id));
    const found = hash && (await read<PersonToken>(c, byHash(hash)));
    if (found) out.push(found);
  }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Revoke a person token, everywhere at once, by one of the addresses it acts for. Undefined when it is not theirs. */
export async function revokePersonToken(id: string, emails: string[]) {
  const c = await controlDb();
  const hash = c && (await read<string>(c, byId(id)));
  const found = hash && (await read<PersonToken>(c!, byHash(hash)));
  if (!found || found.revoked_at || !found.emails.some((e) => emails.includes(e))) return undefined;
  await write(c!, byHash(hash as string), { ...found, revoked_at: new Date().toISOString() });
  return { revoked: id, name: found.name, everywhere: true };
}
