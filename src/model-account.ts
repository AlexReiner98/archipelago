// A workspace's own model account: what the reader, and anything else here that asks a model, runs on. Hosted
// plans do not include a model (the owner, 20 Oct 2026): each workspace brings its own, Anthropic, OpenAI or any
// OpenAI-compatible server, connected by its admin on the Workspace page.
//
// The account is a secret the server has to send with every call, so it is sealed where it is stored
// (src/secrets.ts), as the Anthropic key it replaces was, and never read back out: the page is shown which account
// and model, and the key's last four characters. It is tried when it is given, and refused then with a plain
// reason, not found out by the first run that fails.
//
// A workspace without one runs on the server's model (PELAGO_MODEL_URL), when the server has one and offers it
// (PELAGO_MODEL_SHARED, on unless set off); otherwise nothing runs, and that is said plainly.

import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { env } from './env.ts';
import { ANTHROPIC, anthropicHeaders, asker, bearer, OPENAI, shared, type Ask, type Endpoint } from './model.ts';
import type { Archipelago } from './pelago.ts';

export type Provider = 'anthropic' | 'openai' | 'compatible';
export const PROVIDERS: Provider[] = ['anthropic', 'openai', 'compatible'];
export interface ModelAccount {
  provider: Provider;
  /** May be empty for a compatible server that asks for none (one on the same machine, say). */
  key: string;
  /** A compatible server's base, up to and including its version (https://api.example.com/v1). */
  url?: string;
  /** Left out for Anthropic: the server's reader model. */
  model?: string;
  /** What the model costs, in US$ a million tokens, as its admin read it on the provider's price list. */
  price?: Price;
}

export interface Price {
  input: number;
  output: number;
}

/** Anthropic's reader model, priced as Anthropic lists it, when its account says no price of its own. */
const ANTHROPIC_PRICE: Price = { input: 2, output: 10 };

/** The model the reader asks, on Anthropic or the server's model, unless an account names its own. */
export const READER_MODEL = env('READER_MODEL') || 'claude-sonnet-5-5';
/** The setting the account is sealed in, and the Anthropic key that came before it (still read, as an Anthropic account). */
export const ACCOUNT = 'model_account';
const LEGACY = 'anthropic_key';

export const NO_MODEL = 'No model account is connected to this workspace, so nothing here can ask a model. Its admin connects one on the Workspace page, under Model.';

const NAMES: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', compatible: 'The model server' };

/** What one workspace's model calls run on. */
export interface Connection {
  from: 'workspace' | 'server';
  /** Who answers, for what the owner is told. */
  name: string;
  model: string;
  ask: Ask;
  /** What a run costs is worked out from this; without it, a run's cost is not known and not said. */
  price?: Price;
}

type Fetch = typeof fetch;
let make: (key: string | undefined, at: Endpoint) => Ask = (key, at) => asker(key, at);
let fetching: Fetch = (...args) => fetch(...args);
/** Tests: a model that answers from a script, and a fetch for the check made when an account is given. */
export function configureModels(given: { ask?: (key: string | undefined, at: Endpoint) => Ask; fetch?: Fetch }): void {
  if (given.ask) make = given.ask;
  if (given.fetch) fetching = given.fetch;
}

/** Where an account's calls go. */
export const endpointOf = (a: ModelAccount): Endpoint => (a.provider === 'anthropic' ? {} : a.provider === 'openai' ? { url: OPENAI, key: a.key, openai: true } : { url: a.url, key: a.key || undefined });

async function stored(l: Archipelago): Promise<ModelAccount | undefined> {
  const kept = await l.secret(ACCOUNT);
  if (kept) {
    try {
      const a = JSON.parse(kept) as ModelAccount;
      if (PROVIDERS.includes(a.provider) && typeof a.key === 'string') return a;
    } catch {
      // Not an account: read as none, and set again.
    }
  }
  const key = await l.secret(LEGACY);
  return key ? { provider: 'anthropic', key } : undefined;
}

/** What this workspace's model calls run on: its own account, or the server's model where it is offered. Undefined: nothing. */
export async function connection(l: Archipelago): Promise<Connection | undefined> {
  const a = await stored(l);
  if (a) return { from: 'workspace', name: NAMES[a.provider], model: a.model || READER_MODEL, ask: make(a.key || undefined, endpointOf(a)), price: a.price ?? (a.provider === 'anthropic' ? ANTHROPIC_PRICE : undefined) };
  const at = shared();
  if (at) return { from: 'server', name: 'The server’s model', model: READER_MODEL, ask: make(undefined, at) };
  return undefined;
}

export const hasModel = async (l: Archipelago): Promise<boolean> => Boolean(await connection(l));

/** What the page is told: which account and model, a key's last four characters at most, and what runs when there is none. */
export async function modelStatus(l: Archipelago, admin = true) {
  const a = await stored(l);
  const server = shared();
  return {
    account: a ? { provider: a.provider, name: NAMES[a.provider], model: a.model || READER_MODEL, url: a.url ?? null, price: a.price ?? (a.provider === 'anthropic' ? ANTHROPIC_PRICE : null), ...(admin && { key: a.key ? `…${a.key.slice(-4)}` : null }) } : null,
    server_model: server ? READER_MODEL : null,
    default_model: READER_MODEL,
    runs_on: a ? ('workspace' as const) : server ? ('server' as const) : null,
    ...(!a && !server && { note: NO_MODEL }),
  };
}

const PRIVATE = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]] as const) PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10]] as const) PRIVATE.addSubnet(net, bits, 'ipv6');
const isPrivate = (ip: string): boolean => {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  return v4 ? PRIVATE.check(v4, 'ipv4') : PRIVATE.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
};

/** A compatible server's address as it is kept, or why it is not one. PELAGO_MODEL_PRIVATE_URLS=off refuses one on this server's own network. */
export async function baseUrl(given: string | undefined): Promise<string> {
  let url: URL;
  try {
    url = new URL(String(given ?? '').trim());
  } catch {
    throw new Error('Give the server’s address, with its version: https://api.example.com/v1');
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Give the server’s address as https://host/v1, with nothing after it and no sign-in in it: the key goes in its own field.');
  if (/^(off|false|0|no)$/i.test(env('MODEL_PRIVATE_URLS')?.trim() ?? '')) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((x) => x.address);
    if (host === 'localhost' || host.endsWith('.localhost') || addresses.some(isPrivate)) throw new Error('This server does not call addresses on its own network: give the model server’s public address.');
  }
  return url.href.replace(/\/+$/, '');
}

const said = async (res: Response): Promise<string> => {
  // Only the error's own message, and short: a page of whatever answered at that address is not handed back.
  let message = '';
  try {
    const error = (JSON.parse(await res.text()) as { error?: { message?: unknown } | string }).error;
    message = String((typeof error === 'object' ? error?.message : error) ?? '');
  } catch {
    // Not JSON: said by its status alone.
  }
  return message.replace(/\s+/g, ' ').trim().slice(0, 200);
};

/**
 * Try an account before it is kept: Anthropic and OpenAI are asked for the model it names (which costs nothing, and
 * says whether the key is taken and the model is there); a compatible server, which may list no models, is asked
 * for one token. Undefined when it answered; otherwise why it was not saved, in a sentence for the page.
 */
export async function tryAccount(a: ModelAccount, f: Fetch = fetching): Promise<string | undefined> {
  const who = NAMES[a.provider];
  const model = a.model || READER_MODEL;
  const signal = AbortSignal.timeout(20_000);
  let res: Response;
  try {
    if (a.provider === 'anthropic') res = await f(`${ANTHROPIC}/v1/models/${encodeURIComponent(model)}`, { headers: anthropicHeaders(a.key), signal });
    else if (a.provider === 'openai') res = await f(`${OPENAI}/models/${encodeURIComponent(model)}`, { headers: bearer(a.key), signal });
    else res = await f(`${a.url}/chat/completions`, { method: 'POST', headers: bearer(a.key || undefined), body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'Say OK.' }] }), signal });
  } catch {
    return `${who} could not be reached${a.url ? ` at ${a.url}` : ''}, so the account was not saved. Check the address, or try again in a minute.`;
  }
  if (res.ok) return undefined;
  const why = (await said(res)).replace(/\.$/, '');
  if (res.status === 401 || res.status === 403) return `${who} refused that key, so it was not saved. Check that it was copied whole and has not been revoked.`;
  if (res.status === 404 && a.provider !== 'compatible') return `${who} has no model "${model}" for that key, so it was not saved. Check its name.`;
  if (res.status === 404) return `Nothing at ${a.url} answered as a model server${why ? ` (${why})` : ''}, so it was not saved. Check the address ends at its version (…/v1) and the model’s name.`;
  return `${who} answered ${res.status}${why ? `: ${why}` : ''}. The account was not saved.`;
}

/** Keep the account a workspace's admin gave, once it has answered. What it replaces (an Anthropic key set before) goes. */
export async function connectModel(l: Archipelago, input: { provider: Provider; key?: string; url?: string; model?: string; price?: Price }): Promise<ModelAccount> {
  const key = (input.key ?? '').trim();
  const model = (input.model ?? '').trim() || undefined;
  if (!PROVIDERS.includes(input.provider)) throw new Error(`The account is one of: ${PROVIDERS.join(', ')}.`);
  if (!key && input.provider !== 'compatible') throw new Error(`Give the ${NAMES[input.provider]} API key.`);
  if (/^sk-ant-oat/.test(key)) throw new Error('That is a Claude sign-in token (it starts sk-ant-oat), which signs a person in to Claude Code. The server needs an API key: make one at console.anthropic.com, under API keys.');
  if (!model && input.provider !== 'anthropic') throw new Error(`Name the model to use, as ${input.provider === 'openai' ? 'OpenAI' : 'the server'} names it.`);
  if (model && model.length > 200) throw new Error('That is not a model’s name.');
  const account: ModelAccount = { provider: input.provider, key, ...(input.provider === 'compatible' && { url: await baseUrl(input.url) }), ...(model && { model }), ...(input.price && { price: input.price }) };
  const refused = await tryAccount(account);
  if (refused) throw new Error(refused);
  await l.setSecret(ACCOUNT, JSON.stringify(account));
  await l.setSecret(LEGACY, undefined);
  return account;
}

/** A price a person typed: two amounts of US$ a million tokens, from nothing to a thousand. */
export function priceOf(input: { price_in?: number; price_out?: number }): Price | undefined {
  if (input.price_in === undefined && input.price_out === undefined) return undefined;
  const fine = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000;
  if (!fine(input.price_in) || !fine(input.price_out)) throw new Error('Give both prices, in US$ a million tokens: what the model charges for what it reads (in) and for what it writes (out).');
  return { input: input.price_in!, output: input.price_out! };
}

/** Change what the connected model is said to cost, keeping its key. */
export async function priceModel(l: Archipelago, price: Price | undefined): Promise<ModelAccount> {
  const a = await stored(l);
  if (!a) throw new Error('Connect a model account first.');
  const { price: _, ...rest } = a;
  const account: ModelAccount = { ...rest, ...(price && { price }) };
  await l.setSecret(ACCOUNT, JSON.stringify(account));
  await l.setSecret(LEGACY, undefined);
  return account;
}

export async function forgetModel(l: Archipelago): Promise<void> {
  await l.setSecret(ACCOUNT, undefined);
  await l.setSecret(LEGACY, undefined);
}

/** In a word or two, which account and model, for the log: never the key. */
export const named = (a: ModelAccount): string => `${NAMES[a.provider]}${a.url ? ` (${new URL(a.url).host})` : ''}, ${a.model || READER_MODEL}`;
