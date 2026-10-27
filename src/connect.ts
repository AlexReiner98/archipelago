// What a machine with no Archipelago checkout needs to work with this server: the
// hook script, the friction skill and the working rules are files in this
// repository, so the server hands them out, wrapped in one script that puts
// each where Claude Code looks for it (scripts/pelago-setup.mjs). Nothing in
// it is secret: the token stays in the machine's environment. A running system
// asks here for a token of its own, which a person approves (src/token-ask.ts).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { bearer } from './auth.ts';
import { normalEmail } from './mail.ts';
import { recordAgreement } from './agreements.ts';
import { emailOfLink, LINK_MINUTES, redeem, redeemTyped, requestSignIn, typedWorks, workspaceOfCode } from './members.ts';
import { serverPacksOf } from './server-host.ts';
import { serveServerPack } from './server-routes.ts';
import { pollSignup, receiveLemon, signedByLemon, signupOffer, startSignup } from './signup.ts';
import { pageStyle } from './styles.ts';
import { askForToken, pollForToken } from './token-ask.ts';
import { workingRules } from './working-rules.ts';
import type { Workspaces } from './workspaces.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
/** The working rules as handed out: the file with the packs' instructions said in it, read once. */
const RULES = workingRules();

/**
 * Which hand-out this server gives: a mark that moves when any file the setup
 * writes does (the hook, the rules with the instructions said in them, the
 * skill, the setup itself and so the hooks it registers). The setup writes it
 * into the project's hook, which says it with every call, so a session can be
 * told its project is behind.
 */
export const SETUP_VERSION = createHash('sha256')
  .update([read('scripts/pelago-hook.mjs'), read('.claude/skills/pelago-bump/SKILL.md'), RULES, read('scripts/pelago-setup.mjs')].join('\n'))
  .digest('hex')
  .slice(0, 12);

/** The one command, with no secret in it, that sets a project up or brings its files up to date. */
export const setupCommand = (origin: string) => `node -e "fetch('${origin}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))"`;

/** The setup script for a project that is to work with the server at this address; tokens says whether that server asks for one. */
export function setupScript(origin: string, tokens = true): string {
  const files = {
    // Away from this repository the hook has no local server to fall back on: it calls the one that handed it out.
    hook: read('scripts/pelago-hook.mjs').replace(`'http://127.0.0.1:3100'`, JSON.stringify(origin)).replace(`const SETUP = '';`, `const SETUP = '${SETUP_VERSION}';`),
    skill: read('.claude/skills/pelago-bump/SKILL.md'),
    home: `# Where bumps live\n\nWorkspace: ${origin}.\n\nFind the feature that gathers friction with Archipelago by search (type \`software.feature\`, q \`friction\`). If this workspace has none, make the bump an issue that is part of the project you are working in, and say in its first line that it is about Archipelago itself.\n`,
    rules: RULES,
  };
  return `const ORIGIN = ${JSON.stringify(origin)};\nconst TOKENS = ${tokens};\nconst FILES = ${JSON.stringify(files)};\n${read('scripts/pelago-setup.mjs')}`;
}

/** What the /connect routes are handed by the server: its names, whether it signs in with tokens, and its counts. */
export interface ConnectRoutes {
  hosts: string[];
  named: string[];
  tokens: boolean;
  /** The workspace a request that names none is for. */
  fallback: string;
  workspaces: Pick<Workspaces, 'has' | 'get' | 'hold' | 'list' | 'create'>;
  /** True, and the request answered, when its address has asked too often. */
  tooOften: () => boolean;
  body: () => Promise<unknown>;
  /** The body as it came, for what is signed over its bytes. Read it or body, not both. */
  raw: () => Promise<Buffer>;
}

/** One sign-in mail a minute to an address, whoever asks: the form cannot be used to flood someone's inbox. */
const lately = new Map<string, number>();
function askedLately(email: string): boolean {
  const now = Date.now();
  for (const [e, at] of lately) if (now - at > 60_000) lately.delete(e);
  if (lately.has(email)) return true;
  lately.set(email, now);
  return false;
}

const reply = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));

/**
 * Everything under /connect/ and /x/, none of it behind a token: the setup script, a system's request for a token (POST
 * /connect/request) and its poll (POST /connect/poll/<workspace>/<id>, the poll's secret as Authorization: Bearer).
 * Each is counted as the other open routes are, and given only under a name this server answers to.
 */
export async function serveConnect(req: IncomingMessage, res: ServerResponse, path: string, at: ConnectRoutes) {
  const host = req.headers.host ?? '';
  if (!at.hosts.includes(host)) return reply(res, 404, { error: 'Not found' });
  // What a server pack offers anyone: its pages, entries and webhooks (src/server-routes.ts).
  if (path.startsWith('/x/')) return serveServerPack(req, res, path, at);
  const origin = `${at.named.includes(host) ? 'https' : 'http'}://${host}`;
  if (req.method === 'GET' && path === '/connect/setup.mjs') {
    if (at.tooOften()) return;
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(setupScript(origin, at.tokens));
  }
  // The page's colours and lengths before anyone is signed in, so the sign-in page is drawn like every other.
  if (req.method === 'GET' && path === '/connect/theme') {
    if (at.tooOften()) return;
    const { style } = await pageStyle((await at.workspaces.get(at.fallback)).pelago, {}, false);
    return reply(res, 200, { theme: style.theme ?? null, lengths: style.lengths ?? null });
  }
  // The documents a person agrees to before they are signed in, for a page that asks for them first (a signup).
  if (req.method === 'GET' && path === '/connect/agreements') {
    if (at.tooOften()) return;
    return reply(res, 200, { agreements: await serverPacksOf(at.workspaces).agreements() });
  }
  // Buying a workspace: what is sold, a request that goes on to the checkout, and the browser that began it asking
  // whether it is made. Lemon Squeezy's word that it is paid for comes signed, from no browser (src/signup.ts).
  if (path === '/connect/signup' && req.method === 'GET') return reply(res, 200, signupOffer());
  if (path === '/connect/signup' && req.method === 'POST') {
    if (!at.tokens) return reply(res, 404, { error: 'This server signs nobody in.' });
    if (at.tooOften()) return;
    try {
      return reply(res, 200, await startSignup(at.workspaces, ((await at.body()) ?? {}) as { name?: unknown; email?: unknown }));
    } catch (err) {
      return reply(res, 400, { error: (err as Error).message });
    }
  }
  const signup = req.method === 'POST' ? /^\/connect\/signup\/(su_[a-z0-9]{8})$/.exec(path) : null;
  if (signup) {
    if (at.tooOften()) return;
    const answer = await pollSignup(at.workspaces, signup[1], bearer(req.headers.authorization) ?? '');
    return reply(res, answer.state === 'gone' ? 410 : 200, answer);
  }
  if (path === '/connect/lemon' && req.method === 'POST') {
    if (at.tooOften()) return;
    const raw = await at.raw();
    if (!signedByLemon(raw, req.headers['x-signature'] as string | undefined)) return reply(res, 401, { error: 'Not signed with this server’s webhook secret.' });
    try {
      return reply(res, 200, await receiveLemon(at.workspaces, raw));
    } catch (err) {
      console.error(`lemon squeezy delivery: ${(err as Error).message}`);
      return reply(res, 500, { error: (err as Error).message });
    }
  }
  // Signing in by email: a link asked for at an address, and a link opened, its code traded once for a token.
  if (req.method === 'POST' && (path === '/connect/sign-in' || path === '/connect/join' || path === '/connect/code')) {
    if (!at.tokens) return reply(res, 404, { error: 'This server signs nobody in.' });
    if (at.tooOften()) return;
    const body = ((await at.body()) ?? {}) as { email?: unknown; code?: unknown; agree?: unknown };
    const all = async () => (await at.workspaces.list()).map((w) => ({ ...w, db: async () => (await at.workspaces.get(w.id)).pelago.db }));
    // Before a code is traded, the documents this person has not agreed to at their current version: recorded if the
    // request agrees to them, else answered so the page can ask. The code is not spent while anything is owed.
    const owes = async (email: string) => {
      const current = await serverPacksOf(at.workspaces).agreements();
      if (!current.length) return [];
      return recordAgreement((await at.workspaces.get(at.fallback)).pelago.db, email, body.agree, current, 'sign-in');
    };
    if (path === '/connect/sign-in') {
      const email = normalEmail(body.email);
      if (!email) return reply(res, 400, { error: 'That is not an email address.' });
      // Answered at once and the same either way: whether the address is a member anywhere is not told.
      if (!askedLately(email)) void requestSignIn(await all(), email, origin).catch((err) => console.error(`sign-in mail to ${email} failed:`, (err as Error).message));
      return reply(res, 200, { sent_to: email });
    }
    // A code from the mail, typed with the address it was sent to.
    if (path === '/connect/code') {
      const email = normalEmail(body.email);
      if (!email) return reply(res, 400, { error: 'That is not an email address.' });
      // Asked only once the code is known to work, so the answer says nothing of an address the asker cannot sign in as.
      if (await typedWorks(await all(), email, String(body.code ?? ''))) {
        const owed = await owes(email);
        if (owed.length) return reply(res, 200, { agree: owed });
      }
      const traded = await redeemTyped(await all(), (await at.workspaces.get(at.fallback)).pelago.db, email, String(body.code ?? ''));
      if (traded === 'tries') return reply(res, 429, { error: `Too many wrong codes for this address. Wait ${LINK_MINUTES} minutes, then ask for a new email.` });
      return traded === 'gone' ? reply(res, 410, { error: 'That code was not accepted: it may be mistyped, used or run out.' }) : reply(res, 200, traded);
    }
    const code = String(body.code ?? '');
    const workspace = workspaceOfCode(code);
    const gone = () => reply(res, 410, { error: 'This sign-in link has been used or has run out. Ask for a new one.' });
    if (!workspace || !(await at.workspaces.has(workspace))) return gone();
    res.once('close', at.workspaces.hold(workspace));
    const db = (await at.workspaces.get(workspace)).pelago.db;
    const email = await emailOfLink(db, code);
    if (!email) return gone();
    const owed = await owes(email);
    if (owed.length) return reply(res, 200, { agree: owed });
    const token = await redeem(db, workspace, code);
    return token ? reply(res, 200, { token }) : gone();
  }
  const poll = /^\/connect\/poll\/([a-z0-9-]+)\/(a_[0-9a-f]{12})$/.exec(path);
  if (req.method !== 'POST' || !(path === '/connect/request' || poll)) return reply(res, 404, { error: 'Not found' });
  // A system asks from a shell, never from a web page; and with no tokens there is nothing to hand it.
  if (req.headers.origin) return reply(res, 403, { error: 'A system asks for its token itself, not from a web page.' });
  if (!at.tokens) return reply(res, 404, { error: 'This server signs nobody in with tokens: there is no token to ask for.' });
  if (at.tooOften()) return;
  const body = poll ? undefined : ((await at.body()) ?? {}) as { workspace?: unknown };
  const workspace = poll ? poll[1] : typeof body?.workspace === 'string' ? body.workspace : at.fallback;
  if (!(await at.workspaces.has(workspace))) return reply(res, 404, { error: `No workspace "${workspace}".` });
  res.once('close', at.workspaces.hold(workspace));
  const db = (await at.workspaces.get(workspace)).pelago.db;
  if (poll) {
    const answer = await pollForToken(db, workspace, poll[2], bearer(req.headers.authorization) ?? '');
    return reply(res, answer.state === 'gone' ? 410 : 200, answer);
  }
  try {
    const asked = await askForToken(db, body);
    return reply(res, 200, {
      code: asked.code,
      poll: { url: `${origin}/connect/poll/${workspace}/${asked.id}`, secret: asked.secret },
      approve_at: `${origin}/`,
      expires_at: asked.expires_at,
      note: `Show the code. A person approves it on Home, or on the page of an item watched at an address you named. Poll every few seconds with POST and Authorization: Bearer <secret> until it says approved (with the token, given once), refused or gone.`,
    });
  } catch (err) {
    return reply(res, 400, { error: (err as Error).message });
  }
}
