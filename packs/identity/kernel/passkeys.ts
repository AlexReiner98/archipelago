// Passkeys (the owner, 14 Nov 2026; e_9ewt9kc6): a person signed in adds one, and from then on signs in with it, a tap
// and no code. A passkey is a key pair the person's device keeps; this server keeps its public half, under the address
// it was added for, in its own database (control values, beside passwords: ./passwords.ts), and checks each sign-in's
// signature over a challenge it gave out. No library: the browser hands over the public key as SPKI
// (getPublicKey()), so no CBOR is read, and node's crypto checks ES256, Ed25519 and RS256. Attestation is not asked for.
// What comes after a sign-in is the same as for every way in (./verified.ts).
//
// POST /connect/passkey/options: a challenge, for signing in. POST /connect/passkey: the signed answer, traded for a
// ticket. POST /connect/passkey/add/options and /connect/passkey/add: the same for adding one, signed in.

import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import type { Q } from '../../database/kernel/db.ts';
import { keep, take } from '../../database/kernel/transient.ts';
import { controlValue, setControlValue } from './control.ts';
import type { Answered, SignInAt } from './sign-in.ts';
import { ticketFor } from './verified.ts';

interface Kept {
  email: string;
  /** The public key, SPKI DER in base64url, and its COSE algorithm. */
  key: string;
  alg: number;
  counter: number;
  added: string;
}

const CHALLENGE = 'passkey-challenge:';
const KEY = (id: string) => `passkey:${id}`;
const OF = (email: string) => `passkeys:${email}`;
const CHALLENGE_MINUTES = 5;
/** ES256, Ed25519, RS256: what every platform's passkeys use. */
const ALGS = [-7, -8, -257];

const answer = (status: number, body: unknown): Answered => ({ status, body });
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();
const bytes = (v: unknown) => Buffer.from(typeof v === 'string' ? v : '', 'base64url');

/** The name a passkey is bound to: the page's host, without its port. A passkey made at localhost works at localhost only. */
export const rpOf = (origin: string) => new URL(origin).hostname;

async function challengeFor(control: Q, value: Record<string, unknown>): Promise<string> {
  const challenge = randomBytes(32).toString('base64url');
  await keep(control, CHALLENGE + challenge, value, CHALLENGE_MINUTES * 60_000);
  return challenge;
}

/** The browser's own words about the ceremony, checked: its kind, the challenge it signed (taken once) and the page it ran on. */
async function ceremony(control: Q, clientData: Buffer, type: string, origin: string): Promise<Record<string, unknown> | undefined> {
  let said: { type?: string; challenge?: string; origin?: string };
  try {
    said = JSON.parse(clientData.toString('utf8'));
  } catch {
    return undefined;
  }
  if (said.type !== type || said.origin !== origin || typeof said.challenge !== 'string') return undefined;
  return (await take<Record<string, unknown>>(control, CHALLENGE + said.challenge))?.value;
}

/** The authenticator's data, checked: for this server's name, with the person present. Its signature counter, or undefined. */
function authenticated(data: Buffer, origin: string): number | undefined {
  if (data.length < 37 || !data.subarray(0, 32).equals(sha(rpOf(origin))) || !(data[32] & 0x01)) return undefined;
  return data.readUInt32BE(33);
}

/** POST /connect/passkey/options: a challenge for signing in with any passkey this device has for this server. */
export async function signInOptions(at: SignInAt, origin: string): Promise<Answered> {
  return answer(200, { challenge: await challengeFor(await at.workspaces.control(), { for: 'sign-in' }), rpId: rpOf(origin) });
}

/** POST /connect/passkey { id, clientDataJSON, authenticatorData, signature }: a ticket for the address the passkey was added for. */
export async function passkeySignIn(at: SignInAt, origin: string): Promise<Answered> {
  const control = await at.workspaces.control();
  const body = ((await at.body()) ?? {}) as Record<string, unknown>;
  const refused = answer(401, { error: 'That passkey was not accepted here.' });
  const id = typeof body.id === 'string' ? body.id : '';
  const passkey = id ? await controlValue<Kept>(control, KEY(id)) : undefined;
  const clientData = bytes(body.clientDataJSON), data = bytes(body.authenticatorData);
  if ((await ceremony(control, clientData, 'webauthn.get', origin))?.for !== 'sign-in' || !passkey) return refused;
  const counter = authenticated(data, origin);
  if (counter === undefined) return refused;
  const key = createPublicKey({ key: bytes(passkey.key), format: 'der', type: 'spki' });
  const signed = Buffer.concat([data, sha(clientData)]);
  if (!verify(passkey.alg === -8 ? null : 'sha256', signed, key, bytes(body.signature))) return refused;
  // A counter that went back means the key was copied: refused. Most passkeys keep none (0), and are taken as they are.
  if (counter && passkey.counter && counter <= passkey.counter) return refused;
  await setControlValue(control, KEY(id), { ...passkey, counter });
  return answer(200, { ticket: await ticketFor(control, { email: passkey.email, via: 'passkey', for: 'sign-in' }) });
}

/** The address of the person signed in, if they are one with an address here; never an agent's or a look pass's. */
async function signedInAddress(at: SignInAt): Promise<{ email: string; person: string } | undefined> {
  const { ws, actor, look } = await at.person();
  const who = actor();
  if (look || who.kind !== 'human' || !who.person) return undefined;
  const { rows } = await ws.pelago.db.query<{ email: string }>(`select email from member where person_id = $1 and removed_at is null limit 1`, [who.person]);
  return rows[0] && { email: rows[0].email, person: who.person };
}

/** POST /connect/passkey/add/options: what the browser makes a passkey with, for the address signed in. */
export async function addOptions(at: SignInAt, origin: string): Promise<Answered> {
  const me = await signedInAddress(at);
  if (!me) return answer(403, { error: 'A passkey is added by a person signed in with their address.' });
  const control = await at.workspaces.control();
  const challenge = await challengeFor(control, { for: 'add', email: me.email });
  const exclude = (await controlValue<string[]>(control, OF(me.email))) ?? [];
  return answer(200, { challenge, rp: { id: rpOf(origin), name: 'Archipelago' }, user: { id: Buffer.from(me.email).toString('base64url'), name: me.email, displayName: me.email }, algs: ALGS, exclude });
}

/** POST /connect/passkey/add { id, clientDataJSON, authenticatorData, publicKey, alg }: the passkey kept for the address signed in. */
export async function addPasskey(at: SignInAt, origin: string): Promise<Answered> {
  const me = await signedInAddress(at);
  if (!me) return answer(403, { error: 'A passkey is added by a person signed in with their address.' });
  const control = await at.workspaces.control();
  const body = ((await at.body()) ?? {}) as Record<string, unknown>;
  const refused = answer(400, { error: 'That passkey could not be added. Try again.' });
  const asked = await ceremony(control, bytes(body.clientDataJSON), 'webauthn.create', origin);
  if (asked?.for !== 'add' || asked.email !== me.email) return refused;
  const data = bytes(body.authenticatorData);
  const counter = authenticated(data, origin);
  // Made with its credential: the id the browser names is the one the authenticator says it made.
  if (counter === undefined || !(data[32] & 0x40) || data.length < 55) return refused;
  const id = data.subarray(55, 55 + data.readUInt16BE(53)).toString('base64url');
  const alg = Number(body.alg);
  if (id !== body.id || !ALGS.includes(alg)) return refused;
  try {
    createPublicKey({ key: bytes(body.publicKey), format: 'der', type: 'spki' });
  } catch {
    return refused;
  }
  await setControlValue(control, KEY(id), { email: me.email, key: String(body.publicKey), alg, counter, added: new Date().toISOString() } satisfies Kept);
  const ids = (await controlValue<string[]>(control, OF(me.email))) ?? [];
  await setControlValue(control, OF(me.email), [...new Set([...ids, id])]);
  return answer(200, { added: id });
}

/** Whether the address signed in has a passkey here, for the page to offer one or not. */
export async function hasPasskey(at: SignInAt): Promise<Answered> {
  const me = await signedInAddress(at);
  if (!me) return answer(200, { passkeys: 0 });
  return answer(200, { passkeys: ((await controlValue<string[]>(await at.workspaces.control(), OF(me.email))) ?? []).length });
}
