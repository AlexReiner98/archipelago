// A client that signs in through the browser: OAuth for MCP (the specification of 2026-07-28), with this server as both
// the authorization server and the resource, on the sign-in it already has. /mcp answers 401 with where to look; the
// client reads that, opens /oauth/authorize, and the page (ui/authorize.js) has a signed-in person say Allow or Deny.
// Allow is a code, traded once with PKCE for an agent token acting for that person, as Connect an agent makes one
// (grantToken in src/auth.ts). Which workspace is whichever that person signed in to, so one address serves everyone.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ACCESS_MINUTES, grantToken, rotateGrant, workspaceOfGrant } from './auth.ts';
import type { ConnectRoutes } from './connect.ts';
import type { Q } from './db.ts';
import { clientOf, listedRedirect, registerClient, returnsTo, type Client } from './oauth-clients.ts';
import { keep, take } from './transient.ts';

/** How long a code waits to be traded. */
const CODE_MINUTES = 5;
/** The one scope: what the person who said Allow may do, under the workspace's rules. */
const SCOPE = 'map';
const KEY = 'oauth-code:';

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
const originOf = (host: string, named: string[]) => `${named.includes(host) ? 'https' : 'http'}://${host}`;

/** What /mcp says to a caller with no good token: where to read how to get one. */
export const challenge = (host: string, named: string[]) => `Bearer resource_metadata="${originOf(host, named)}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"`;

const resourceMeta = (origin: string) => ({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'Archipelago' });
const serverMeta = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  registration_endpoint: `${origin}/oauth/register`,
  // A client that may keep a refresh token asks for it by offline_access; it gets one either way.
  scopes_supported: [SCOPE, 'offline_access'],
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  client_id_metadata_document_supported: true,
  authorization_response_iss_parameter_supported: true,
});

/** The resource a client names, in the forms clients write it: this server's /mcp, or left out. */
function ourResource(resource: string | null, origin: string): boolean {
  if (!resource) return true;
  return [origin, `${origin}/mcp`].includes(resource.toLowerCase().replace(/\/$/, ''));
}

class Unsendable extends Error {}

interface Asked {
  client: Client;
  redirect: string;
  challenge: string;
  state: string | null;
}

/**
 * What an authorization request asks. A bad client or redirect cannot be sent back to and throws Unsendable; the rest
 * is answered to the client as OAuth says.
 */
async function askedBy(query: URLSearchParams, origin: string): Promise<Asked & { problem?: [string, string] }> {
  const client = await clientOf(query.get('client_id'));
  if (!client) throw new Unsendable('This server could not read that client.');
  const redirect = query.get('redirect_uri') ?? (client.redirects.length === 1 ? client.redirects[0] : '');
  if (!redirect || !listedRedirect(client, redirect)) throw new Unsendable('That client asked to return somewhere it did not list.');
  const code = query.get('code_challenge') ?? '';
  const asked = { client, redirect, challenge: code, state: query.get('state') };
  if (query.get('response_type') !== 'code') return { ...asked, problem: ['unsupported_response_type', 'Only response_type=code.'] };
  if (query.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(code)) return { ...asked, problem: ['invalid_request', 'PKCE with S256 is required.'] };
  if (!ourResource(query.get('resource'), origin)) return { ...asked, problem: ['invalid_target', 'That resource is not this server.'] };
  return asked;
}

/** The address a client is sent back to with what it is told. */
function back(asked: Asked, origin: string, said: Record<string, string>): string {
  const url = new URL(asked.redirect);
  for (const [name, value] of Object.entries({ ...said, ...(asked.state !== null && { state: asked.state }), iss: origin })) url.searchParams.set(name, value);
  return url.href;
}

const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }).end(JSON.stringify(body));
const oauthError = (res: ServerResponse, status: number, error: string, description: string) => json(res, status, { error, error_description: description });

/** The page's request for a code: Allow from a signed-in person, or Deny. Answers where the browser goes next. */
async function answerAsked(res: ServerResponse, origin: string, at: ConnectRoutes): Promise<unknown> {
  const body = ((await at.body()) ?? {}) as { query?: unknown; allow?: unknown };
  const query = new URLSearchParams(String(body.query ?? ''));
  const asked = await askedBy(query, origin).catch((err) => {
    if (err instanceof Unsendable) return undefined;
    throw err;
  });
  if (!asked || asked.problem) return json(res, 400, { error: 'This request to connect cannot go on. Start again from the client.' });
  // Refused with 401 if the browser holds no good sign-in, and by kind: an agent cannot say Allow for a person.
  const { ws, actor } = await at.person();
  const who = actor();
  if (who.kind !== 'human') return json(res, 403, { error: 'A person says Allow, not an agent.' });
  if (body.allow !== true) return json(res, 200, { redirect: back(asked, origin, { error: 'access_denied' }) });
  const code = `oac_${ws.id}_${randomBytes(20).toString('hex')}`;
  await keep(ws.pelago.db, KEY + hash(code), { client: asked.client.id, name: asked.client.name, redirect: asked.redirect, challenge: asked.challenge, person: who.person ?? null, resource: query.get('resource') }, CODE_MINUTES * 60_000);
  return json(res, 200, { redirect: back(asked, origin, { code }), workspace: ws.id });
}

interface Waiting {
  client: string;
  name: string;
  redirect: string;
  challenge: string;
  person: string | null;
}

const samePkce = (verifier: string, challenge: string) => {
  const given = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const wanted = Buffer.from(challenge);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
};

/** The token endpoint's form, or JSON from a client that sends that. */
async function formOf(req: IncomingMessage, at: ConnectRoutes): Promise<URLSearchParams> {
  const raw = (await at.raw()).toString();
  if (!String(req.headers['content-type'] ?? '').includes('json')) return new URLSearchParams(raw);
  try {
    return new URLSearchParams(JSON.parse(raw) as Record<string, string>);
  } catch {
    return new URLSearchParams();
  }
}

const issued = (made: { access: string; refresh: string }) => ({ access_token: made.access, token_type: 'Bearer', expires_in: ACCESS_MINUTES * 60, refresh_token: made.refresh, scope: SCOPE });

async function trade(req: IncomingMessage, res: ServerResponse, origin: string, at: ConnectRoutes): Promise<unknown> {
  const form = await formOf(req, at);
  const grant = form.get('grant_type');
  const secret = form.get(grant === 'refresh_token' ? 'refresh_token' : 'code') ?? '';
  const refused = () => oauthError(res, 400, 'invalid_grant', 'That code or refresh token is not good: it may be used, revoked or run out.');
  if (grant !== 'authorization_code' && grant !== 'refresh_token') return oauthError(res, 400, 'unsupported_grant_type', 'Only authorization_code and refresh_token.');
  if (!ourResource(form.get('resource'), origin)) return oauthError(res, 400, 'invalid_target', 'That resource is not this server.');
  const workspace = workspaceOfGrant(secret);
  if (!workspace || !(await at.workspaces.has(workspace))) return refused();
  res.once('close', at.workspaces.hold(workspace));
  const db: Q = (await at.workspaces.get(workspace)).pelago.db;
  if (grant === 'refresh_token') {
    const rotated = await rotateGrant(db, workspace, secret, form.get('client_id') ?? undefined);
    return rotated ? json(res, 200, issued(rotated)) : refused();
  }
  const waiting = (await take<Waiting>(db, KEY + hash(secret)))?.value;
  if (!waiting || waiting.client !== form.get('client_id') || waiting.redirect !== form.get('redirect_uri') || !samePkce(form.get('code_verifier') ?? '', waiting.challenge)) return refused();
  return json(res, 200, issued(await grantToken(db, workspace, { name: waiting.name, entity: waiting.person ?? undefined, client: waiting.client })));
}

/** Everything under /oauth/ and /.well-known/, and only with tokens on: with none there is nothing to sign in to. */
export async function serveOAuth(req: IncomingMessage, res: ServerResponse, path: string, at: ConnectRoutes): Promise<unknown> {
  const host = req.headers.host ?? '';
  if (!at.tokens) return json(res, 404, { error: 'This server signs nobody in.' });
  if (at.tooOften()) return;
  const origin = originOf(host, at.named);
  if (req.method === 'OPTIONS') return res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version', 'access-control-allow-methods': 'GET, POST, OPTIONS' }).end();
  if (req.method === 'GET' && /^\/\.well-known\/oauth-protected-resource(\/mcp)?$/.test(path)) return json(res, 200, resourceMeta(origin));
  if (req.method === 'GET' && /^\/\.well-known\/oauth-authorization-server(\/mcp)?$/.test(path)) return json(res, 200, serverMeta(origin));
  if (req.method === 'POST' && path === '/oauth/register') {
    try {
      return json(res, 201, registerClient(await at.body()));
    } catch (err) {
      return oauthError(res, 400, 'invalid_client_metadata', (err as Error).message);
    }
  }
  if (req.method === 'POST' && path === '/oauth/token') return trade(req, res, origin, at);
  if (req.method === 'POST' && path === '/oauth/allow') return answerAsked(res, origin, at);
  // What the page says before anyone is signed in: who is asking, and where they return to.
  if (req.method === 'POST' && path === '/oauth/describe') {
    const query = new URLSearchParams(String((((await at.body()) ?? {}) as { query?: unknown }).query ?? ''));
    try {
      const asked = await askedBy(query, origin);
      return asked.problem ? json(res, 400, { error: asked.problem[1] }) : json(res, 200, { client: asked.client.name, returns_to: returnsTo(asked.redirect) });
    } catch (err) {
      if (err instanceof Unsendable) return json(res, 400, { error: err.message });
      throw err;
    }
  }
  if (req.method === 'GET' && path === '/oauth/authorize') {
    const search = new URL(req.url ?? '/', origin).searchParams;
    try {
      const asked = await askedBy(search, origin);
      if (asked.problem) return res.writeHead(302, { location: back(asked, origin, { error: asked.problem[0], error_description: asked.problem[1] }) }).end();
    } catch (err) {
      if (err instanceof Unsendable) return res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(err.message);
      throw err;
    }
    return res.writeHead(302, { location: `/#/authorize?${search}`, 'cache-control': 'no-store' }).end();
  }
  return json(res, 404, { error: 'Not found' });
}
