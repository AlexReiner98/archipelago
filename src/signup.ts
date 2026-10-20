// A stranger buys a workspace: no operator, no secret handed over. The sign-up page keeps a request (a name and an
// address) and sends the browser to Lemon Squeezy's checkout with the request's id. Lemon Squeezy, the seller of
// record, tells this server when the subscription is made (a webhook signed with a secret only it and the server
// hold); the server then makes the workspace and its first admin. The browser that began it, holding the request's
// secret, is signed in to the new workspace once, as soon as it exists; later sign-ins are by email, as any
// member's. What the subscription does after that (cancelled, expired, a card that failed) is kept and told to the
// owner of the default workspace, and nothing is done to the customer's workspace by itself.
//
// It is the server's, not a map's: requests are kept as transient state and subscriptions in the control plane,
// both in the default workspace's database. Configured by PELAGO_LEMON_CHECKOUT (the variant's checkout link),
// PELAGO_LEMON_SECRET (the webhook's signing secret) and PELAGO_SIGNUP_PRICE (what the page says it costs).

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { validWorkspaceId } from './auth.ts';
import { claimControlValue, controlValue, setControlValue } from './control.ts';
import { newId, type Q } from './db.ts';
import { env } from './env.ts';
import { normalEmail } from './mail.ts';
import { admitOwner, memberToken } from './members.ts';
import { notify } from './notify.ts';
import { keep, kept, take } from './transient.ts';
import type { Workspace, Workspaces } from './workspaces.ts';

/** How long a request waits for its payment. */
const REQUEST_MS = 2 * 86_400_000;
/** Ids nobody signs up for. */
const RESERVED = ['default', 'www', 'app', 'api', 'admin', 'mail', 'staging', 'archipelago'];

type Places = Pick<Workspaces, 'has' | 'get' | 'create'>;
interface Request {
  email: string;
  name: string;
  secret: string;
  workspace?: string;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const requestKey = (id: string) => `signup:${id}`;
const subscriptionKey = (id: string) => `lemon_subscription:${id}`;
const home = async (at: Places) => (await at.get('default')).pelago;

/** Whether this server sells workspaces, and what the page says one costs. */
export const signupOffer = () => ({ open: Boolean(env('LEMON_CHECKOUT') && env('LEMON_SECRET')), price: env('SIGNUP_PRICE') ?? null });

/** A workspace id from a name: its words, lowercase and joined by hyphens, with a number added if it is taken. */
export async function freeId(at: Pick<Workspaces, 'has'>, name: string): Promise<string> {
  const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '') || 'workspace';
  for (let n = 1; n < 1000; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (validWorkspaceId(id) && !RESERVED.includes(id) && !(await at.has(id))) return id;
  }
  throw new Error('No free workspace id for that name.');
}

/** Begin: keep the request and give the checkout to send the browser to, with the secret it keeps to be signed in. */
export async function startSignup(at: Places, input: { name?: unknown; email?: unknown }) {
  const checkout = env('LEMON_CHECKOUT');
  if (!signupOffer().open || !checkout) throw new Error('This server does not sell workspaces.');
  const email = normalEmail(input.email);
  if (!email) throw new Error('That is not an email address.');
  const name = String(input.name ?? '').trim();
  if (!name || name.length > 60) throw new Error('Give the workspace a name of up to 60 characters.');
  const id = newId('su');
  const secret = randomBytes(24).toString('hex');
  await keep((await home(at)).db, requestKey(id), { email, name, secret: hash(secret) } satisfies Request, REQUEST_MS);
  const url = new URL(checkout);
  url.searchParams.set('checkout[email]', email);
  url.searchParams.set('checkout[custom][signup]', id);
  url.searchParams.set('checkout[custom][name]', name);
  return { checkout: url.toString(), request: id, secret };
}

/** Asked by the browser that began it: still waiting, or the new workspace and a sign-in to it, given once. */
export async function pollSignup(at: Places, id: string, secret: string): Promise<{ state: 'waiting' } | { state: 'ready'; workspace: { id: string; name: string }; token: string } | { state: 'gone' }> {
  const db = (await home(at)).db;
  const request = await kept<Request>(db, requestKey(id));
  if (!request || !secret || !same(request.secret, hash(secret))) return { state: 'gone' };
  if (!request.workspace) return { state: 'waiting' };
  // Given once: whichever poll takes it first is signed in.
  if (!(await take(db, requestKey(id)))) return { state: 'gone' };
  const ws = await at.get(request.workspace);
  const token = await memberToken(ws.pelago.db, ws.id, request.email);
  return token ? { state: 'ready', workspace: { id: ws.id, name: ws.name }, token } : { state: 'gone' };
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Whether a delivery was signed with the webhook's secret: X-Signature is the HMAC-SHA256 of the raw body, in hex. */
export function signedByLemon(raw: Buffer, signature: string | undefined, secret = env('LEMON_SECRET')): boolean {
  if (!secret || !signature) return false;
  return same(createHmac('sha256', secret).update(raw).digest('hex'), signature.trim());
}

interface Delivery {
  meta?: { event_name?: string; custom_data?: { signup?: string; name?: string } };
  data?: { id?: string; type?: string; attributes?: Record<string, unknown> };
}

/** What Lemon Squeezy says of a subscription, kept against the workspace it paid for. */
export interface Subscription {
  workspace: string;
  email: string;
  status: string;
  renews_at?: string | null;
  ends_at?: string | null;
  trial_ends_at?: string | null;
  updated: string;
}

/** A webhook delivery, already checked as signed. Answers what it did; a repeated delivery does nothing again. */
export async function receiveLemon(at: Places, raw: Buffer): Promise<{ done: string; workspace?: string }> {
  const delivery = JSON.parse(raw.toString('utf8')) as Delivery;
  const event = delivery.meta?.event_name ?? '';
  const sub = delivery.data?.type === 'subscriptions' ? String(delivery.data.id ?? '') : '';
  if (!event.startsWith('subscription_') || !sub) return { done: 'ignored' };
  const attrs = delivery.data?.attributes ?? {};
  const owner = await home(at);
  const control: Q = owner.db;
  const facts = { status: String(attrs.status ?? ''), renews_at: (attrs.renews_at as string) ?? null, ends_at: (attrs.ends_at as string) ?? null, trial_ends_at: (attrs.trial_ends_at as string) ?? null, updated: new Date().toISOString() };

  if (event !== 'subscription_created') {
    const known = await controlValue<Subscription>(control, subscriptionKey(sub));
    if (!known) return { done: 'unknown subscription' };
    await setControlValue(control, subscriptionKey(sub), { ...known, ...facts });
    if (known.status !== facts.status && ['cancelled', 'expired', 'past_due', 'unpaid', 'paused'].includes(facts.status))
      await tell(owner, `The subscription for "${known.workspace}" is ${facts.status}`, `${known.email}. Nothing was done to the workspace: write to them, and decide.`, 'warning');
    return { done: facts.status || 'updated', workspace: known.workspace };
  }

  // Made once, whoever delivers it first: the subscription is claimed before the workspace is made.
  if (!(await claimControlValue(control, subscriptionKey(sub), { workspace: '', email: '', ...facts }))) return { done: 'already made', workspace: (await controlValue<Subscription>(control, subscriptionKey(sub)))?.workspace };
  const signup = delivery.meta?.custom_data?.signup;
  const request = signup ? await kept<Request>(control, requestKey(signup)) : undefined;
  const email = normalEmail(attrs.user_email) ?? request?.email;
  const name = (request?.name ?? String(delivery.meta?.custom_data?.name ?? '')).trim().slice(0, 60) || email?.split('@')[0] || 'Workspace';
  if (!email) throw new Error('The subscription names no email address.');
  let ws: Workspace;
  try {
    ws = await at.create(await freeId(at, name), name);
    await admitOwner(ws.pelago, email);
  } catch (err) {
    await control.query(`delete from control_value where key = $1`, [subscriptionKey(sub)]);
    throw err;
  }
  await setControlValue(control, subscriptionKey(sub), { workspace: ws.id, email, ...facts } satisfies Subscription);
  if (signup && request) await keep(control, requestKey(signup), { ...request, workspace: ws.id } satisfies Request, REQUEST_MS);
  await tell(owner, `"${name}" was bought`, `${email} signed up: the workspace "${ws.id}" is made, with them as its admin (${facts.status}).`, 'info');
  return { done: 'made', workspace: ws.id };
}

/** Tell the owner of the default workspace. */
async function tell(l: Awaited<ReturnType<typeof home>>, title: string, body: string, level: 'info' | 'warning') {
  const me = await l.setting<string>('me');
  await notify(l, { kind: 'agent', name: 'billing' }, { title, body, level, ...(me && { about: me }) }).catch((err) => console.error(`billing notice: ${(err as Error).message}`));
}
