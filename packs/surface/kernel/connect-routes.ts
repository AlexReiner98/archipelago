// The routes open to anyone, before anyone is known: everything under /connect/ and /x/, OAuth and its well-known
// addresses, none of it behind a token. The surface's (the owner, 12 Nov 2026, e_wuqn82rf): which names the server
// answers to, how often an address may ask, and what each path is. What a path says is its owner's: sign-in and OAuth
// identity's (../../identity/kernel/sign-in.ts, oauth.ts), a server pack's pages, entries and webhooks the server
// packs' (./server-routes.ts), the install pages and a system's request for its token the connect pack's, and a
// bounce the mail pack's: what is above the surface is handed in by the server (./server.ts), never imported here.
// A sign-in mail goes out as the mail pack's member-mail says, which the server loads with its first start (./first-start.ts).

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Archipelago } from '../../../src/pelago.ts';
import type { Q } from '../../../src/db.ts';
import { bearer } from '../../identity/kernel/auth.ts';
import { serveOAuth } from '../../identity/kernel/oauth.ts';
import { SIGN_IN_PATHS, signIn, type OpenRoutes } from '../../identity/kernel/sign-in.ts';
import { json, PRIVATE } from './reply.ts';
import { serverPacksOf } from './server-host.ts';
import { documentsInForce, signinGate } from './server-gates.ts';
import { serveFile, setupPack } from './server-files.ts';
import { serveServerPack } from './server-routes.ts';

/** What the routes are handed by the server: the request's parts, and what they answer with that is above the surface. */
export interface ConnectRoutes extends OpenRoutes {
  /** An address in its one form (the mail pack's normalEmail). */
  email(given: unknown): string | undefined;
  /** The page's look before anyone is signed in (the styles pack's pageStyle). */
  pageStyle(l: Archipelago): Promise<{ style: { theme?: unknown; lengths?: unknown } }>;
  /** A failure notice the relay hands over (the mail pack's bounces). */
  bounces: { fromRelay(authorization: string | undefined): boolean; failedFor(text: string): string[]; noteBounced(l: Archipelago, failed: string[]): Promise<unknown>; days: number };
  /** The connect pack's answers: the install pages, and a system's request for its token and its poll. */
  connect: {
    installed(path: string, origin: string): { type: string; text: string } | undefined;
    asked(db: Q, body: unknown, origin: string, workspace: string): Promise<{ status: number; body: unknown }>;
    polled(db: Q, workspace: string, id: string, secret: string): Promise<{ status: number; body: unknown }>;
  };
}

/** The short addresses an agent finds or guesses at the root, each answered as the /connect/ path it stands for. */
export const SHORT: Record<string, string> = {
  '/install': '/connect/install',
  '/install.md': '/connect/install.md',
  '/install.ps1': '/connect/install.ps1',
  '/install.sh': '/connect/install.sh',
  '/llms.txt': '/connect/llms.txt',
};

const reply = (res: ServerResponse, status: number, body: unknown) => json(res, status, body, PRIVATE);

/** Every /connect/, /x/, /oauth/ and /.well-known/ request, given only under a name this server answers to. */
export async function serveConnect(req: IncomingMessage, res: ServerResponse, path: string, at: ConnectRoutes) {
  const host = req.headers.host ?? '';
  if (!at.hosts.includes(host)) return reply(res, 404, { error: 'Not found' });
  // What a server pack offers anyone: its pages, entries and webhooks (./server-routes.ts).
  if (path.startsWith('/x/')) return serveServerPack(req, res, path, at);
  // A client signing in through the browser (identity's oauth.ts).
  if (/^\/(oauth|\.well-known)\//.test(path)) return serveOAuth(req, res, path, at);
  const origin = `${at.named.includes(host) ? 'https' : 'http'}://${host}`;
  if (req.method === 'GET' && path === '/connect/setup.mjs') {
    if (at.tooOften()) return;
    // The pack that takes the setup mount hands out its own file; with none, this server hands out no setup.
    const setup = setupPack();
    if (setup) return serveFile(res, setup.pack.file, setup.id, { origin, tokens: at.tokens, folder: setup.pack.folder });
    return reply(res, 404, { error: 'No server pack here hands out a setup.' });
  }
  // Installing Archipelago, by a person or their agent (the connect pack's install.ts): the page, and what its one line fetches.
  const install = req.method === 'GET' ? at.connect.installed(path, origin) : undefined;
  if (install) {
    if (at.tooOften()) return;
    res.writeHead(200, { 'content-type': `${install.type}; charset=utf-8`, 'cache-control': 'no-store' });
    return res.end(install.text);
  }
  // The page's colours and lengths before anyone is signed in, so the sign-in page is drawn like every other.
  if (req.method === 'GET' && path === '/connect/theme') {
    if (at.tooOften()) return;
    const { style } = await at.pageStyle((await at.workspaces.get(at.fallback)).pelago);
    return reply(res, 200, { theme: style.theme ?? null, lengths: style.lengths ?? null });
  }
  // The documents a person agrees to before they are signed in, for a page that asks for them first (a signup).
  if (req.method === 'GET' && path === '/connect/agreements') {
    if (at.tooOften()) return;
    return reply(res, 200, { agreements: await documentsInForce(serverPacksOf(at.workspaces)) });
  }
  // Where a person with no account begins, for the sign-in page to offer: a pack's start page.
  if (req.method === 'GET' && path === '/connect/start') {
    if (at.tooOften()) return;
    return reply(res, 200, { url: serverPacksOf(at.workspaces).start() ?? null });
  }
  // A failure notice the relay hands over: the addresses that failed for good are sent nothing for a while.
  if (req.method === 'POST' && path === '/connect/bounce') {
    if (!at.bounces.fromRelay(req.headers.authorization)) return reply(res, 403, { error: 'Only the relay hands over bounces.' });
    const failed = at.bounces.failedFor((await at.raw()).toString('utf8'));
    await at.bounces.noteBounced((await at.workspaces.get(at.fallback)).pelago, failed);
    if (failed.length) console.log(`bounced for good, not mailed for ${at.bounces.days} days: ${failed.length} address${failed.length === 1 ? '' : 'es'}`);
    return reply(res, 200, { kept: failed.length });
  }
  // Signing in: by email, by a code, by a password, and a password kept (identity's sign-in.ts).
  if (req.method === 'POST' && SIGN_IN_PATHS.includes(path)) {
    if (!at.tokens) return reply(res, 404, { error: 'This server signs nobody in.' });
    if (at.tooOften()) return;
    const owes = async (email: string, agree: unknown) => (await signinGate(serverPacksOf(at.workspaces), { email, agree, via: 'sign-in' })).owes;
    const answer = await signIn(path, { ...at, owes, hold: (workspace) => void res.once('close', at.workspaces.hold(workspace)) });
    return reply(res, answer.status, answer.body);
  }
  // A system's request for a token (POST /connect/request) and its poll (POST /connect/poll/<workspace>/<id>, the
  // poll's secret as Authorization: Bearer): the connect pack's token-ask.ts.
  const poll = /^\/connect\/poll\/([a-z0-9-]+)\/(a_[0-9a-f]{12})$/.exec(path);
  if (req.method !== 'POST' || !(path === '/connect/request' || poll)) return reply(res, 404, { error: 'Not found' });
  // A system asks from a shell, never from a web page; and with no tokens there is nothing to hand it.
  if (req.headers.origin) return reply(res, 403, { error: 'A system asks for its token itself, not from a web page.' });
  if (!at.tokens) return reply(res, 404, { error: 'This server signs nobody in with tokens: there is no token to ask for.' });
  if (at.tooOften()) return;
  const body = poll ? undefined : (((await at.body()) ?? {}) as { workspace?: unknown });
  const workspace = poll ? poll[1] : typeof body?.workspace === 'string' ? body.workspace : at.fallback;
  if (!(await at.workspaces.has(workspace))) return reply(res, 404, { error: `No workspace "${workspace}".` });
  res.once('close', at.workspaces.hold(workspace));
  const db = (await at.workspaces.get(workspace)).pelago.db;
  const answer = poll ? await at.connect.polled(db, workspace, poll[2], bearer(req.headers.authorization) ?? '') : await at.connect.asked(db, body, origin, workspace);
  return reply(res, answer.status, answer.body);
}
