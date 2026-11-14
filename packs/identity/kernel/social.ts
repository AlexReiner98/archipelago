// Signing up or in with Google or GitHub (the owner, 14 Nov 2026: skip the email loop; e_9ewt9kc6): the provider proves
// the address, so no code is mailed. The page asks to start (POST /connect/social: the provider's page to go to), the
// person agrees there, and the provider sends the browser back (GET /connect/social/<provider>/callback) with a code
// traded here, server to server, for the verified address. What comes after is the same as for every way in: a ticket
// the page trades (./verified.ts), to keep a guest map or to sign in.
//
// A provider is offered only where the server has its client: PELAGO_GOOGLE_CLIENT_ID and PELAGO_GOOGLE_CLIENT_SECRET,
// PELAGO_GITHUB_CLIENT_ID and PELAGO_GITHUB_CLIENT_SECRET, each made at the provider with the callback above as its
// redirect. Only the address is asked for (Google's openid email, GitHub's user:email), and only a verified one is taken.

import { createHash, randomBytes } from 'node:crypto';
import { randomHex, sha256Hex } from '../../../src/hashes.ts';
import { keep, take } from '../../database/kernel/transient.ts';
import { guestToKeep } from './guest-keep.ts';
import type { Answered, SignInAt } from './sign-in.ts';
import { ticketFor, type Proved } from './verified.ts';

interface Provider {
  title: string;
  authorize: string;
  token: string;
  scope: string;
  extra: Record<string, string>;
  /** The verified address the token answer proves, or why not. */
  email(answer: Record<string, unknown>, client: Client): Promise<string>;
}
interface Client { id: string; secret: string }

let given = { fetch: (url: string, init?: RequestInit) => globalThis.fetch(url, init), env: (name: string): string | undefined => process.env[name] };
/** What the routes reach out with: a test hands in its own fetch and clients. */
export function configureSocial(with_: Partial<typeof given>) {
  given = { ...given, ...with_ };
}

const b64url = (b: Buffer) => b.toString('base64url');
const STATE = 'social:';
const STATE_MINUTES = 15;

const PROVIDERS: Record<string, Provider> = {
  google: {
    title: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email',
    extra: { prompt: 'select_account' },
    // The ID token comes straight from Google over TLS, so its claims are read without checking its signature (OIDC 3.1.3.7).
    async email(answer, client) {
      const claims = JSON.parse(Buffer.from(String(answer.id_token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8') || '{}') as Record<string, unknown>;
      if (claims.aud !== client.id || !['https://accounts.google.com', 'accounts.google.com'].includes(String(claims.iss))) throw new Error('Google’s answer was not for this server.');
      if (claims.email_verified !== true || typeof claims.email !== 'string') throw new Error('Google has no verified address for that account.');
      return claims.email;
    },
  },
  github: {
    title: 'GitHub',
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'user:email',
    extra: { allow_signup: 'true' },
    // An address may be private on the profile: the account's own list says which is primary and verified.
    async email(answer) {
      const res = await given.fetch('https://api.github.com/user/emails', { headers: { authorization: `Bearer ${answer.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'Archipelago' } });
      const emails = (res.ok ? await res.json() : []) as { email: string; primary: boolean; verified: boolean }[];
      const email = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      if (!email) throw new Error('GitHub has no verified address for that account.');
      return email.email;
    },
  },
};

const clientOf = (provider: string): Client | undefined => {
  const name = `PELAGO_${provider.toUpperCase()}_CLIENT`;
  const id = given.env(`${name}_ID`), secret = given.env(`${name}_SECRET`);
  return id && secret ? { id, secret } : undefined;
};

/** The providers this server signs people up with: those it has a client for. */
export const socialWays = () => Object.keys(PROVIDERS).filter((p) => clientOf(p));

const answer = (status: number, body: unknown): Answered => ({ status, body });
const callbackOf = (origin: string, provider: string) => `${origin}/connect/social/${provider}/callback`;

/** POST /connect/social { provider, for, agree?, machine? }: the provider's page to send the browser to. Keeping a guest map is its owner's alone. */
export async function startSocial(at: SignInAt, origin: string): Promise<Answered> {
  const body = ((await at.body()) ?? {}) as { provider?: unknown; for?: unknown; agree?: unknown; machine?: unknown };
  const provider = PROVIDERS[String(body.provider)] ? String(body.provider) : undefined;
  if (!provider) return answer(400, { error: 'Sign up with Google or GitHub.' });
  const client = clientOf(provider);
  if (!client) return answer(404, { error: `Signing up with ${PROVIDERS[provider].title} is not set up on this server yet.` });
  const purpose: Proved['for'] = body.for === 'keep' ? 'keep' : 'sign-in';
  let workspace: string | undefined;
  if (purpose === 'keep') {
    const mine = await guestToKeep(at);
    if ('status' in mine) return mine;
    workspace = mine.ws.id;
  }
  const state = randomHex(24);
  const verifier = b64url(randomBytes(32));
  const machine = typeof body.machine === 'string' ? body.machine : undefined;
  await keep(await at.workspaces.control(), STATE + sha256Hex(state), { provider, for: purpose, workspace, machine, agree: body.agree, verifier, origin }, STATE_MINUTES * 60_000);
  const url = new URL(PROVIDERS[provider].authorize);
  const ask = { client_id: client.id, redirect_uri: callbackOf(origin, provider), response_type: 'code', scope: PROVIDERS[provider].scope, state, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', ...PROVIDERS[provider].extra };
  for (const [k, v] of Object.entries(ask)) url.searchParams.set(k, v);
  return answer(200, { url: url.href });
}

interface Started { provider: string; for: Proved['for']; workspace?: string; machine?: string; agree?: unknown; verifier: string; origin: string }

/** GET /connect/social/<provider>/callback: where the browser is sent next, the page with a ticket, or the page with why not. */
export async function socialCallback(at: SignInAt, provider: string, query: URLSearchParams): Promise<string> {
  const control = await at.workspaces.control();
  const taken = await take<Started>(control, STATE + sha256Hex(query.get('state') ?? ''));
  const back = (s: Started | undefined, said: Record<string, string>) => `${s?.origin ?? ''}/#/${s?.for === 'sign-in' ? 'sign-in' : 'sign-up'}?${new URLSearchParams(said)}`;
  const started = taken?.value;
  const p = PROVIDERS[provider];
  if (!started || !p || started.provider !== provider) return back(started, { failed: 'That sign-up ran out. Start again.' });
  if (query.get('error')) return back(started, { failed: `Signing up with ${p.title} was cancelled.` });
  const client = clientOf(provider);
  if (!client) return back(started, { failed: `Signing up with ${p.title} is not set up on this server yet.` });
  try {
    const form = new URLSearchParams({ client_id: client.id, client_secret: client.secret, code: query.get('code') ?? '', redirect_uri: callbackOf(started.origin, provider), grant_type: 'authorization_code', code_verifier: started.verifier });
    const res = await given.fetch(p.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form.toString() });
    const said = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || said.error) throw new Error(`${p.title} did not accept the sign-in.`);
    const email = at.email(await p.email(said, client));
    if (!email) throw new Error(`${p.title} gave no address this server can use.`);
    const ticket = await ticketFor(control, { email, via: provider, for: started.for, ...(started.workspace && { workspace: started.workspace }), ...(started.machine && { machine: started.machine }), ...(started.agree !== undefined && { agree: started.agree }) });
    return back(started, { ticket });
  } catch (err) {
    return back(started, { failed: (err as Error).message });
  }
}
