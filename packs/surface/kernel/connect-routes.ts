// The routes open to anyone, before anyone is known: everything under /connect/ and /x/, OAuth and its well-known
// addresses, none of it behind a token. The surface's (the owner, 12 Nov 2026, e_wuqn82rf): which names the server
// answers to, how often an address may ask, and what each path is. What a path says is its owner's: sign-in and OAuth
// identity's (../../identity/kernel/sign-in.ts, oauth.ts), a server pack's pages, entries and webhooks the server
// packs' (./server-routes.ts), the install pages and a system's request for its token the connect pack's, and a
// bounce the mail pack's: what is above the surface is handed in by the server (./server.ts), never imported here.
// A sign-in mail goes out as the mail pack's member-mail says, which the server loads with its first start (./first-start.ts).

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Archipelago } from '../../write/kernel/pelago.ts';
import type { Q } from '../../database/kernel/db.ts';
import { bearer } from '../../identity/kernel/auth.ts';
import { serveOAuth } from '../../identity/kernel/oauth.ts';
import { SIGN_IN_PATHS, signIn, type OpenRoutes } from '../../identity/kernel/sign-in.ts';
import { keepGuestMap } from '../../identity/kernel/guest-keep.ts';
import { socialCallback, socialWays, startSocial } from '../../identity/kernel/social.ts';
import { addOptions, addPasskey, hasPasskey, passkeySignIn, signInOptions } from '../../identity/kernel/passkeys.ts';
import { finishVerified } from '../../identity/kernel/verified.ts';
import { json, PRIVATE } from './reply.ts';
import { serverPacksOf } from './server-host.ts';
import { documentsInForce, keptGate, signinGate } from './server-gates.ts';
import { serveFile, setupPack } from './server-files.ts';
import { serveServerPack } from './server-routes.ts';

/** What the routes are handed by the server: the request's parts, and what they answer with that is above the surface. */
export interface ConnectRoutes extends OpenRoutes {
  /** An address in its one form (the mail pack's normalEmail). */
  email(given: unknown): string | undefined;
  /** The page's look before anyone is signed in (the styles pack's pageStyle). */
  pageStyle(l: Archipelago): Promise<{ style: { theme?: unknown; lengths?: unknown; faces?: unknown; type?: unknown; emblem?: unknown; backdrop?: unknown } }>;
  /** A failure notice the relay hands over (the mail pack's bounces). */
  bounces: { fromRelay(authorization: string | undefined): boolean; failedFor(text: string): string[]; noteBounced(l: Archipelago, failed: string[]): Promise<unknown>; days: number };
  /** The connect pack's answers: the install pages, and a system's request for its token and its poll. */
  connect: {
    installed(path: string, origin: string): { type: string; text: string } | undefined;
    asked(l: Archipelago, body: unknown, origin: string, workspace: string): Promise<{ status: number; body: unknown }>;
    polled(l: Archipelago, workspace: string, id: string, secret: string): Promise<{ status: number; body: unknown }>;
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
/** The ways in that are posted to, beside the code in the mail. */
const OTHER_WAYS = ['/connect/social', '/connect/verified', '/connect/passkey/options', '/connect/passkey', '/connect/passkey/add/options', '/connect/passkey/add', '/connect/passkey/mine'];

/** Every /connect/, /x/, /oauth/ and /.well-known/ request, given only under a name this server answers to. */
/** A still's address: the page it is for (the backdrop's own as _), which (or the page's emblem), and the version of its picture. */
const STILL_PATH = /^\/connect\/still\/(_|[a-z][a-z-]{0,30})\/(wide|narrow|emblem)$/;
const DATA_URL = /^data:(image\/(?:png|webp));base64,([A-Za-z0-9+/=]+)$/;
type Stills = Record<string, Record<string, string> | undefined>;

/** A backdrop's stills by page (its own as _), as the style holds them. */
function stillsOf(backdrop: unknown): Stills {
  const b = (backdrop ?? {}) as { still?: Record<string, string>; pages?: Record<string, { still?: Record<string, string>; emblem?: string }> };
  return { _: b.still, ...Object.fromEntries(Object.entries(b.pages ?? {}).map(([name, p]) => [name, { ...p?.still, ...(p?.emblem && { emblem: p.emblem }) }])) };
}

/** A backdrop with each still named by its address instead of carried whole: the gate's first read stays small. */
function stillsAsAddresses(backdrop: unknown): unknown {
  if (!backdrop || typeof backdrop !== 'object') return backdrop ?? null;
  const at = (page: string, still?: Record<string, string>) =>
    still && Object.fromEntries(Object.entries(still).map(([k, url]) => [k, `/connect/still/${page}/${k}?v=${createHash('sha256').update(url).digest('hex').slice(0, 16)}`]));
  const b = backdrop as { still?: Record<string, string>; pages?: Record<string, { still?: Record<string, string>; emblem?: string }> };
  return { ...b, ...(b.still && { still: at('_', b.still) }), ...(b.pages && { pages: Object.fromEntries(Object.entries(b.pages).map(([name, p]) => [name, { ...p, ...(p?.still && { still: at(name, p.still) }), ...(p?.emblem && { emblem: at(name, { emblem: p.emblem })?.emblem }) }])) }) };
}

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
    return reply(res, 200, { theme: style.theme ?? null, lengths: style.lengths ?? null, faces: style.faces ?? null, type: style.type ?? null, emblem: style.emblem ?? null, backdrop: stillsAsAddresses(style.backdrop) });
  }
  // A gate land's still, at the address /connect/theme names it by: its picture alone, kept by the browser (the address
  // changes with the picture), so a page fetches only the one it shows.
  const still = req.method === 'GET' ? STILL_PATH.exec(path) : null;
  if (still) {
    if (at.tooOften()) return;
    const { style } = await at.pageStyle((await at.workspaces.get(at.fallback)).pelago);
    const picture = DATA_URL.exec(stillsOf(style.backdrop)[still[1]]?.[still[2]] ?? '');
    if (!picture) return reply(res, 404, { error: 'No such still' });
    res.writeHead(200, { 'content-type': picture[1], 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    return res.end(Buffer.from(picture[2], 'base64'));
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
  // Signing in to keep a guest map: the address becomes its owner's, and the pack that sells workspaces is told (identity's guest-keep.ts).
  if (req.method === 'POST' && path === '/connect/keep') {
    if (!at.tokens) return reply(res, 404, { error: 'This server signs nobody in.' });
    if (at.tooOften()) return;
    const packs = serverPacksOf(at.workspaces);
    const owes = async (email: string, agree: unknown) => (await signinGate(packs, { email, agree, via: 'keep' })).owes;
    const kept = async (ask: { workspace: string; email: string; machine?: string }) => keptGate(packs, await at.workspaces.control(), ask);
    const answer = await keepGuestMap({ ...at, owes, kept, hold: (workspace) => void res.once('close', at.workspaces.hold(workspace)) });
    return reply(res, answer.status, answer.body);
  }
  // Signing up or in without a code in the mail: Google or GitHub, or a passkey, each proving an address the same
  // ticket finishes with (identity's social.ts, passkeys.ts, verified.ts).
  const social = /^\/connect\/social\/([a-z]+)\/callback$/.exec(path);
  if ((req.method === 'GET' && (path === '/connect/ways' || social)) || (req.method === 'POST' && OTHER_WAYS.includes(path))) {
    if (!at.tokens) return reply(res, 404, { error: 'This server signs nobody in.' });
    if (at.tooOften()) return;
    if (path === '/connect/ways') return reply(res, 200, { social: socialWays(), passkeys: true });
    const packs = serverPacksOf(at.workspaces);
    const owes = async (email: string, agree: unknown) => (await signinGate(packs, { email, agree, via: 'sign-in' })).owes;
    const signing = { ...at, owes, hold: (workspace: string) => void res.once('close', at.workspaces.hold(workspace)) };
    if (social) return void res.writeHead(302, { ...PRIVATE, location: await socialCallback(signing, social[1], new URL(req.url ?? '', origin).searchParams) }).end();
    const kept = async (ask: { workspace: string; email: string; machine?: string }) => keptGate(packs, await at.workspaces.control(), ask);
    const ways: Record<string, () => Promise<{ status: number; body: unknown }>> = {
      '/connect/social': () => startSocial(signing, origin),
      '/connect/verified': () => finishVerified({ ...signing, kept }, async (via, email, agree) => (await signinGate(packs, { email, agree, via })).owes),
      '/connect/passkey/options': () => signInOptions(signing, origin),
      '/connect/passkey': () => passkeySignIn(signing, origin),
      '/connect/passkey/add/options': () => addOptions(signing, origin),
      '/connect/passkey/add': () => addPasskey(signing, origin),
      '/connect/passkey/mine': () => hasPasskey(signing),
    };
    const answer = await ways[path]();
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
  const map = (await at.workspaces.get(workspace)).pelago;
  const answer = poll ? await at.connect.polled(map, workspace, poll[2], bearer(req.headers.authorization) ?? '') : await at.connect.asked(map, body, origin, workspace);
  return reply(res, answer.status, answer.body);
}
