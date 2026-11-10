// A password, for a person who wants one beside the emailed link (the owner, 10 Nov 2026: review for Claude's
// connector directory should feel standard, an email and a password). A person signed in sets it for their address, and
// from then on signs in with the two wherever a code works, the page a client sends them to for Allow among them.
// Losing it costs nothing: the emailed link still signs them in, and they set another.
//
// It belongs to the address, not to a workspace, as a sign-in does: kept in the server's own database (control values,
// src/control.ts) as a scrypt hash with its salt, never the password. Wrong ones are counted per address there, as
// wrong codes are (src/members.ts), and past PASSWORD_TRIES the address waits.

import { randomBytes, scrypt } from 'node:crypto';
import type { Q } from './db.ts';
import { sameBytes } from './hashes.ts';
import { keep, kept } from './transient.ts';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
/** Wrong passwords an address is allowed, and for how long they are counted. */
export const PASSWORD_TRIES = 10;
export const TRIES_MINUTES = 30;

/** The work a guess costs: scrypt with 32 MB, about a tenth of a second, said with each hash so it can be raised. */
const COST = { N: 2 ** 15, r: 8, p: 1 };
const LENGTH = 32;

interface Kept {
  salt: string;
  hash: string;
  N: number;
  r: number;
  p: number;
  set_at: string;
}

const KEY = (email: string) => `password:${email}`;
const TRIES = (email: string) => `password-tries:${email}`;

const derive = (password: string, salt: Buffer, cost: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((done, fail) => scrypt(password.normalize('NFKC'), salt, LENGTH, { ...cost, maxmem: 128 * cost.N * cost.r * 2 }, (err, key) => (err ? fail(err) : done(key))));

/** What is wrong with a password offered to be kept, if anything. */
export function passwordProblem(password: unknown): string | undefined {
  if (typeof password !== 'string') return 'A password is text.';
  if ([...password].length < PASSWORD_MIN) return `A password is at least ${PASSWORD_MIN} characters.`;
  if ([...password].length > PASSWORD_MAX) return `A password is at most ${PASSWORD_MAX} characters.`;
  return undefined;
}

/** Keep this address's password, in place of any before it. */
export async function setPassword(control: Q, email: string, password: string): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const salt = randomBytes(16);
  const hash = await derive(password, salt, COST);
  const value: Kept = { salt: salt.toString('hex'), hash: hash.toString('hex'), ...COST, set_at: new Date().toISOString() };
  await control.query(`insert into control_value (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [KEY(email), JSON.stringify(value)]);
}

/** This address signs in by email alone again. */
export async function clearPassword(control: Q, email: string): Promise<void> {
  await control.query(`delete from control_value where key = $1`, [KEY(email)]);
}

/** Whether this address has a password, and since when. */
export async function passwordSet(control: Q, email: string): Promise<string | undefined> {
  return (await keptPassword(control, email))?.set_at;
}

async function keptPassword(control: Q, email: string): Promise<Kept | undefined> {
  return (await control.query<{ value: Kept }>(`select value from control_value where key = $1`, [KEY(email)])).rows[0]?.value;
}

/** A salt for an address with no password: the guess costs the same, so the time taken says nothing of who has one. */
const NONE = { salt: '00'.repeat(16), hash: '00'.repeat(LENGTH), ...COST };

/**
 * Whether this is the address's password. A wrong one is counted; the caller asks passwordTriesSpent first, so past the
 * tries nothing says whether a password would work.
 */
export async function passwordWorks(control: Q, email: string, password: unknown): Promise<boolean> {
  if (typeof password !== 'string' || !password || [...password].length > PASSWORD_MAX) return wrong(control, email);
  const known = await keptPassword(control, email);
  const held = known ?? NONE;
  const given = await derive(password, Buffer.from(held.salt, 'hex'), held);
  if (known && sameBytes(given, Buffer.from(held.hash, 'hex'))) return true;
  return wrong(control, email);
}

async function wrong(control: Q, email: string): Promise<false> {
  await keep(control, TRIES(email), ((await kept<number>(control, TRIES(email))) ?? 0) + 1, TRIES_MINUTES * 60_000);
  return false;
}

/** Whether this address has used up its wrong passwords for now. */
export const passwordTriesSpent = async (control: Q, email: string) => ((await kept<number>(control, TRIES(email))) ?? 0) >= PASSWORD_TRIES;
