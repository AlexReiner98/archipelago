// What a server pack asks of the hosts it declares, made by the kernel while the pack's call runs (ctx.request). The
// pack never sees a secret: the kernel adds it. A host may say how the kernel proves who it is: a secret sent as a
// bearer token, or a short-lived token the kernel signs (RS256) with a key it keeps for the pack, which it may also
// trade at a declared path for a token to act as one account, kept until it runs out. A request may name fields of
// the answer that are secrets to keep (keep): the kernel seals them in the control plane under the names given and
// takes them out of what the pack is handed, so a key a host makes for the pack is never seen by it.

import { createSign } from 'node:crypto';
import { controlValue, setControlValue } from './control.ts';
import type { Q } from './db.ts';
import { env } from './env.ts';
import { seal, unseal } from './secrets.ts';
import { envSecret, type ServerHost, type ServerPackFile } from './server-packs.ts';

export interface HostRequest {
  host: string;
  method?: string;
  /** Under the host's base address. */
  path: string;
  body?: unknown;
  /** Act as this account: the signed token is traded for its token first (the host's exchange). */
  as?: string;
  /** Send no credential at all. */
  anonymous?: boolean;
  /** Fields of the answer to keep as the pack's secrets, by the name of each, and leave out of what it is handed. */
  keep?: Record<string, string>;
}

const TIMEOUT_MS = 20_000;
const secretKey = (pack: string, name: string) => `pack_secret:${pack}:${name}`;

/** A secret of a server pack: set at run time and sealed in the control plane, else from the environment. */
export async function serverSecret(control: Q, pack: Pick<ServerPackFile, 'id' | 'reach'>, name: string): Promise<string | undefined> {
  const kept = unseal(await controlValue<string>(control, secretKey(pack.id, name)));
  return kept ?? envSecret(pack, name);
}

/** The base a host is called at: as declared, unless the server's configuration moves it (PELAGO_HOST_<PACK>_<HOST>). */
export const hostBase = (pack: string, host: ServerHost): string => env(`HOST_${pack}_${host.id}`.toUpperCase()) ?? host.base;

/** Tokens traded for, by pack, host and account, kept until a minute before they run out. */
const traded = new Map<string, { token: string; expires: number }>();

/** Forget what was traded for with a pack's old secrets. */
const forget = (pack: string) => {
  for (const key of traded.keys()) if (key.startsWith(`${pack}/`)) traded.delete(key);
};

async function keepSecret(control: Q, pack: ServerPackFile, name: string, value: string): Promise<void> {
  if (!pack.reach?.secrets?.some((s) => s.name === name)) throw new Error(`The ${pack.id} pack declares no secret "${name}"`);
  await setControlValue(control, secretKey(pack.id, name), seal(value));
  forget(pack.id);
}

/** The short-lived token the kernel signs for a host, with the key it keeps for the pack. */
async function signed(control: Q, pack: ServerPackFile, host: ServerHost): Promise<string> {
  const { key, issuer, minutes = 9 } = host.sign!;
  const [pem, iss] = await Promise.all([serverSecret(control, pack, key), serverSecret(control, pack, issuer)]);
  if (!pem || !iss) throw new Error(`The ${pack.id} pack has no ${pem ? issuer : key} yet: its host "${host.id}" cannot be asked as it.`);
  const now = Math.floor(Date.now() / 1000);
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const said = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + minutes * 60, iss })}`;
  // A key from the environment may have its line breaks written as \n.
  return `${said}.${createSign('RSA-SHA256').update(said).sign(pem.replaceAll('\\n', '\n'), 'base64url')}`;
}

async function call(base: string, host: ServerHost, method: string, path: string, authorization: string | undefined, body?: unknown): Promise<{ status: number; body: unknown }> {
  const root = new URL(base.endsWith('/') ? base : `${base}/`);
  const url = new URL(path.replace(/^\/+/, ''), root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) throw new Error(`${path} is outside the host ${host.id}`);
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'pelago', ...host.headers };
  if (authorization) headers.authorization = authorization;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

/** The token to act as one account, traded for with the signed token and kept until it runs out. */
async function tradedFor(control: Q, pack: ServerPackFile, host: ServerHost, as: string): Promise<string> {
  if (!/^[\w.-]{1,100}$/.test(as)) throw new Error(`"${as}" cannot name an account`);
  const key = `${pack.id}/${host.id}/${as}`;
  const held = traded.get(key);
  if (held && held.expires > Date.now() + 60_000) return held.token;
  const { path, token, expires } = host.exchange!;
  const made = await call(hostBase(pack.id, host), host, 'POST', path.replaceAll('{as}', encodeURIComponent(as)), `Bearer ${await signed(control, pack, host)}`);
  const answer = (made.body ?? {}) as Record<string, unknown>;
  if (made.status >= 300 || typeof answer[token] !== 'string') throw new Error(`${host.id} gave no token for ${as} (${made.status}${answer.message ? `: ${answer.message}` : ''})`);
  traded.set(key, { token: answer[token] as string, expires: Date.parse(String(answer[expires])) || Date.now() + 10 * 60_000 });
  return answer[token] as string;
}

/** Make one request for a server pack to a host it declares, with the credential the host says, and give back the answer. */
export async function hostRequest(control: Q, pack: ServerPackFile, r: HostRequest): Promise<{ status: number; body: unknown; kept?: string[] }> {
  const host = pack.reach?.hosts?.find((h) => h.id === r.host);
  if (!host) throw new Error(`The ${pack.id} pack declares no host "${r.host}"`);
  let authorization: string | undefined;
  if (!r.anonymous) {
    if (r.as !== undefined) {
      if (!host.exchange) throw new Error(`The host "${host.id}" trades for no account's token`);
      authorization = `Bearer ${await tradedFor(control, pack, host, String(r.as))}`;
    } else if (host.sign) authorization = `Bearer ${await signed(control, pack, host)}`;
    else if (host.secret) {
      const secret = await serverSecret(control, pack, host.secret);
      if (!secret) throw new Error(`The ${pack.id} pack has no secret "${host.secret}" yet`);
      authorization = `Bearer ${secret}`;
    }
  }
  const made = await call(hostBase(pack.id, host), host, (r.method ?? (r.body === undefined ? 'GET' : 'POST')).toUpperCase(), r.path, authorization, r.body);
  if (!r.keep || made.status >= 300 || !made.body || typeof made.body !== 'object') return made;
  const body = made.body as Record<string, unknown>;
  const kept: string[] = [];
  for (const [field, name] of Object.entries(r.keep)) {
    if (body[field] === undefined || body[field] === null) continue;
    await keepSecret(control, pack, name, String(body[field]));
    delete body[field];
    kept.push(name);
  }
  return { ...made, kept };
}
