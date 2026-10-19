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
import { askForToken, pollForToken } from './token-ask.ts';
import type { Workspaces } from './workspaces.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/**
 * Which hand-out this server gives: a mark that moves when any file the setup
 * writes does (the hook, the rules, the skill, the setup itself and so the
 * hooks it registers). The setup writes it into the project's hook, which
 * says it with every call, so a session can be told its project is behind.
 */
export const SETUP_VERSION = createHash('sha256')
  .update(['scripts/pelago-hook.mjs', '.claude/skills/pelago-bump/SKILL.md', 'examples/working-rules.md', 'scripts/pelago-setup.mjs'].map(read).join('\n'))
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
    rules: read('examples/working-rules.md'),
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
  workspaces: Pick<Workspaces, 'has' | 'get' | 'hold'>;
  /** True, and the request answered, when its address has asked too often. */
  tooOften: () => boolean;
  body: () => Promise<unknown>;
}

const reply = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));

/**
 * Everything under /connect/, none of it behind a token: the setup script, a system's request for a token (POST
 * /connect/request) and its poll (POST /connect/poll/<workspace>/<id>, the poll's secret as Authorization: Bearer).
 * Each is counted as the other open routes are, and given only under a name this server answers to.
 */
export async function serveConnect(req: IncomingMessage, res: ServerResponse, path: string, at: ConnectRoutes) {
  const host = req.headers.host ?? '';
  if (!at.hosts.includes(host)) return reply(res, 404, { error: 'Not found' });
  const origin = `${at.named.includes(host) ? 'https' : 'http'}://${host}`;
  if (req.method === 'GET' && path === '/connect/setup.mjs') {
    if (at.tooOften()) return;
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(setupScript(origin, at.tokens));
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
