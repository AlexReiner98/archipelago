// One local process owns the databases and serves every surface:
//   POST /mcp          MCP (streamable HTTP) for agents
//   POST /api/<tool>   the same tools for the human CLI and web UI
//   POST /agent/<tool> the same tools as plain JSON, for hooks and scripts
//                      that cannot speak MCP
//   POST /hooks/session-start, /hooks/session-end, /hooks/prompt
//                      Claude Code HTTP hooks: a session registers itself and
//                      is handed what the map knows about its repository
//   POST /github/<workspace>  GitHub's webhook: pushes, signed with the
//                      workspace's secret
//   /github/app/...    the server's GitHub App: created once, connected by
//                      each workspace, and every push delivered to /hook
//   GET  /whoami       which workspace and identity a request resolves to
//   GET  /connect/setup.mjs  a script that connects the project it is run in
//                      to this server: tools, hooks, the friction skill and
//                      the working rules (no secret in it)
//   /operator/workspaces  list and create workspaces (empty, or from a backup
//                      file), and issue a workspace a new owner token
//                      (operator secret)
//   POST /operator/reset  replace a lost operator secret (`lattice operator-reset`)
//   GET  /             the web UI
// It listens on 127.0.0.1 unless told otherwise, and beyond it only with tokens on.
//
// Who is calling is decided one of two ways. With auth off (the default, for
// one person on one machine) there is a single workspace and the surface
// decides: /api is the human, everything else an agent. With auth "tokens",
// every request carries a token that names its workspace and its identity,
// and the surface no longer matters.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { bearer, createToken, hasHumanToken, verifyToken, workspaceOf } from './auth.ts';
import { notify } from './notify.ts';
import { backupAll, newestBackup, parseBackup } from './backup.ts';
import { loadConfig, RESTART_EXIT, startedFrom } from './config.ts';
import { SETUP_VERSION, setupCommand, setupScript } from './connect.ts';
import { deliveryPayload, receivePush, signedByGithub } from './github.ts';
import { addRepositories, GithubApp } from './github-app.ts';
import { configureLauncher, stopAllLaunched } from './launcher.ts';
import type { Actor, Lattice } from './lattice.ts';
import { configureOutbox } from './outbox.ts';
import { hasReaderKey, readable, readPush, readUnread, recheck } from './reader.ts';
import { publicPage, publicPicture } from './public.ts';
import { configureSecrets } from './secrets.ts';
import { hookSessionEnd, hookSessionStart, recordUsage, sessionBegan, sessionHeard } from './sessions.ts';
import { callTool, configureBackup, configureGithubApp, configureRestart, describeChanges, devMode, humanChanges, latestSeq, TOOLS } from './tools.ts';
import { DEFAULT_WORKSPACE, Workspaces, type Workspace } from './workspaces.ts';

const actorField = {
  actor: z.string().optional().describe('Who you are, e.g. "claude-code:aperture". Recorded against everything you do.'),
};

/**
 * A client keeps the tool list it was given when it connected. An input added
 * since is one it does not know the type of, and it sends it as a string:
 * "true", "[...]". Where an input is not a string and what arrived is one
 * that spells a value the input takes, it is taken as that value.
 */
export function lenient<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value !== 'string' || schema.safeParse(value).success) return value;
    try {
      const spelt = JSON.parse(value);
      return schema.safeParse(spelt).success ? spelt : value;
    } catch {
      return value;
    }
  }, schema);
}

function buildMcp(lattice: Lattice, actorFor: (label?: string) => Actor): McpServer {
  const mcp = new McpServer({ name: 'lattice', version: '0.1.0' });
  for (const [name, tool] of Object.entries(TOOLS)) {
    if (tool.humanOnly || (tool.devOnly && !devMode())) continue;
    const inputSchema = { ...Object.fromEntries(Object.entries(tool.input).map(([key, schema]) => [key, lenient(schema as z.ZodType)])), ...actorField };
    mcp.registerTool(name, { description: tool.description, inputSchema }, async (args: Record<string, unknown>) => {
      const { actor, ...input } = args;
      try {
        const result = await callTool(lattice, actorFor(actor as string | undefined), name, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: (err as Error).message }], isError: true };
      }
    });
  }
  return mcp;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const text = (await readBody(req)).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const UI_DIR = join(import.meta.dirname, '..', 'ui');
const UI_FILES: Record<string, string> = {
  '/': 'index.html',
  '/app.js': 'app.js',
  '/style.css': 'style.css',
  '/public.js': 'public.js',
  '/public.css': 'public.css',
};
const MIME: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css' };

class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createHttpServer(workspaces: Workspaces, port: number, options: { auth?: 'off' | 'tokens'; publicHosts?: string[]; github?: GithubApp } = {}): Server {
  // The names this server answers to. A request for any other host is refused,
  // which is what stops another web page from reaching it through the browser.
  const named = options.publicHosts ?? [];
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...named];
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...named.map((name) => `https://${name}`)];
  const tokens = options.auth === 'tokens';
  configureOutbox(async (id) => (workspaces.has(id) ? (await workspaces.get(id)).lattice : undefined));
  const github = options.github;
  configureGithubApp(github);

  // Which code this is and since when: after a push the old server goes on answering until the new one is up.
  const running = { commit: startedFrom(), started: new Date().toISOString() };

  /** Per Claude Code session: the last event it has been told about by the prompt hook. */
  const heardUpTo = new Map<string, number>();

  /** The workspace a request is for and who is making it. */
  async function resolve(req: IncomingMessage, res: ServerResponse, surface: 'human' | 'agent'): Promise<{ ws: Workspace; lattice: Lattice; actor: (label?: string) => Actor }> {
    if (!tokens) {
      const ws = await workspaces.get(DEFAULT_WORKSPACE);
      return { ws, lattice: ws.lattice, actor: (label) => (surface === 'human' ? { kind: 'human', name: 'local', admin: true } : { kind: 'agent', name: label || 'claude' }) };
    }
    const token = bearer(req.headers.authorization);
    const id = token && workspaceOf(token);
    // The same answer whether the token is malformed, unknown, expired or for
    // a workspace that does not exist: nothing to probe.
    const denied = new Refused(401, 'A valid token is required. Send it as: Authorization: Bearer <token>');
    if (!token || !id || !workspaces.has(id)) throw denied;
    // The workspace stays open for as long as this request lasts, however long that is.
    res.once('close', workspaces.hold(id));
    const ws = await workspaces.get(id);
    // Where the request came from, as the proxy in front of the server says, or the connection itself. It is a help
    // in noticing a token used somewhere new, not a control: a caller can claim to come from anywhere.
    const forwarded = req.headers['x-forwarded-for'];
    const from = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() || req.socket.remoteAddress;
    const identity = await verifyToken(ws.lattice.db, token, from);
    if (!identity) throw denied;
    if (identity.newPlace)
      await notify(ws.lattice, { kind: 'agent', name: 'lattice' }, {
        title: `The token "${identity.actor.name}" was used from a new place`,
        body: `It was used from ${identity.newPlace}, where it had not been used before. A machine that has moved networks does this. If it is not one of yours, revoke the token on the Workspace screen: whoever has it can act as that ${identity.actor.kind}.`,
        level: 'warning',
      }).catch((err) => console.error(`notify: ${(err as Error).message}`));
    // A token's identity is fixed; an agent may add a label to say which session it is.
    return {
      ws,
      // Everything this request reads or writes goes through the database as
      // this person sees it. A token tied to nobody sees only what is shared.
      lattice: ws.lattice.as(identity.actor.person ?? ''),
      actor: (label) => (label && identity.actor.kind === 'agent' ? { ...identity.actor, name: `${identity.actor.name}/${label}` } : identity.actor),
    };
  }

  /**
   * A token with full control of a workspace, for the operator to hand over.
   * It is the owner's own when the workspace has one, so it sees what is
   * private to them: a map brought in from a backup arrives with its owner.
   */
  async function ownerToken(ws: Workspace, name: string) {
    const owner = await createToken(ws.lattice.db, ws.id, { kind: 'human', name, admin: true, entity: await ws.lattice.setting<string>('me') });
    return { workspace: { id: ws.id, name: ws.name }, owner_token: owner.token, note: owner.note };
  }

  /** Keep other web pages out: only our own UI's origin, only JSON, only our host name. */
  const local = (req: IncomingMessage, needJson = true) =>
    !(req.headers.origin && !origins.includes(req.headers.origin)) && hosts.includes(req.headers.host ?? '') && (!needJson || Boolean(req.headers['content-type']?.startsWith('application/json')));

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, name: 'lattice', ...running });

      // What a project needs to work with this server, as one script to run in its folder. It holds no secret,
      // so it needs no token; it is given only under a name this server answers to, which it then writes down.
      if (req.method === 'GET' && url.pathname === '/connect/setup.mjs') {
        const host = req.headers.host ?? '';
        if (!hosts.includes(host)) return send(res, 404, { error: 'Not found' });
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(setupScript(`${named.includes(host) ? 'https' : 'http'}://${host}`));
      }

      // A product's public page: open to anyone, on any name this server has. It is read as the public role sees the
      // map, so there is nothing here to guard: what is not public is not there to be found.
      const pub = req.method === 'GET' ? /^\/p\/([^/]+)\/([^/]+)(?:\/(data|picture)(?:\/([^/]+))?)?\/?$/.exec(url.pathname) : null;
      if (pub) {
        const [, wsId, product, what, extra] = pub;
        const guard = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
        if (!what) {
          res.writeHead(200, { ...guard, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
          return res.end(await readFile(join(UI_DIR, 'public.html')));
        }
        const none = () => res.writeHead(404, { ...guard, 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
        if (!workspaces.has(wsId)) return none();
        const { lattice } = await workspaces.get(wsId);
        if (what === 'data') {
          const page = await publicPage(lattice, product, url.searchParams.get('build') ?? undefined);
          if (!page) return none();
          return res.writeHead(200, { ...guard, 'content-type': 'application/json', 'cache-control': 'public, max-age=30' }).end(JSON.stringify(page));
        }
        const picture = extra ? await publicPicture(lattice, extra) : null;
        if (!picture) return none();
        return res.writeHead(200, { ...guard, 'content-type': picture.content_type, 'cache-control': 'public, max-age=300', 'content-security-policy': "default-src 'none'" }).end(picture.bytes);
      }

      if (req.method === 'GET' && UI_FILES[url.pathname]) {
        const file = UI_FILES[url.pathname];
        res.writeHead(200, { 'content-type': `${MIME[file.split('.').pop()!]}; charset=utf-8`, 'cache-control': 'no-store' });
        return res.end(await readFile(join(UI_DIR, file)));
      }

      if (req.method === 'GET' && url.pathname === '/whoami') {
        if (!local(req, false)) return send(res, 403, { error: 'Local requests only.' });
        const { ws, actor } = await resolve(req, res, 'human');
        return send(res, 200, { auth: tokens ? 'tokens' : 'off', dev: devMode(), workspace: { id: ws.id, name: ws.name }, actor: actor() });
      }

      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, { error: 'This server is stateless: POST only.' });
        const { lattice, actor } = await resolve(req, res, 'agent');
        const mcp = buildMcp(lattice, actor);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableDnsRebindingProtection: true,
          allowedHosts: hosts,
        });
        res.on('close', () => {
          void transport.close();
          void mcp.close();
        });
        await mcp.connect(transport);
        return await transport.handleRequest(req, res, await readJson(req));
      }

      const surface = url.pathname.startsWith('/api/') ? 'api' : url.pathname.startsWith('/agent/') ? 'agent' : undefined;
      if (req.method === 'POST' && surface) {
        if (!local(req)) return send(res, 403, { error: 'The API accepts only local JSON requests from the CLI, hooks or the lattice UI.' });
        const { lattice, actor } = await resolve(req, res, surface === 'api' ? 'human' : 'agent');
        const name = url.pathname.slice(surface.length + 2);
        try {
          const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
          if (surface === 'api') return send(res, 200, { result: await callTool(lattice, actor(), name, body) });
          // Scripts say which one they are in the body, as MCP callers do in their arguments.
          const { actor: label, ...input } = body;
          return send(res, 200, { result: await callTool(lattice, actor((label as string) || 'script'), name, input) });
        } catch (err) {
          return send(res, 400, { error: (err as Error).message });
        }
      }

      // The GitHub App. Someone is sent to GitHub and comes back to one of these three; what proves they
      // started here is the one-time word they carry (state), so no token is asked for.
      if (github && req.method === 'GET' && url.pathname.startsWith('/github/app/')) {
        const q = url.searchParams;
        const page = (status: number, html: string) => res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
        const back = () => res.writeHead(302, { location: '/#/workspace' }).end();
        try {
          if (url.pathname === '/github/app/new') return page(200, github.createPage(q.get('state')));
          if (url.pathname === '/github/app/created') {
            await github.created(q.get('code'), q.get('state'));
            return back();
          }
          if (url.pathname === '/github/app/installed') {
            // Sent back after choosing repositories: the first time with the word that says whose workspace it is
            // for, later (the choice changed on GitHub) without one, when the installation is known already.
            const id = q.get('installation_id');
            const known = id ? github.workspaceOf(id) : undefined;
            const workspace = q.get('state') || !known ? (await github.installed(id, q.get('state'))).workspace : known;
            const release = workspaces.hold(workspace);
            try {
              const { lattice } = await workspaces.get(workspace);
              await addRepositories(lattice, await github.repositories(id!), github.installationOf(workspace)?.account ?? '');
            } finally {
              release();
            }
            return back();
          }
        } catch (err) {
          return page(400, `<!doctype html><meta charset="utf-8"><body style="font: 15px system-ui; padding: 40px"><p>${(err as Error).message.replaceAll('<', '&lt;')}</p><p><a href="/#/workspace">Back to Lattice</a></p>`);
        }
      }
      // Everything the app's installations do arrives here, signed with the app's secret; the installation says whose workspace it is for.
      if (github && req.method === 'POST' && url.pathname === '/github/app/hook') {
        const body = await readBody(req);
        if (!github.signed(body, req.headers['x-hub-signature-256'])) return send(res, 401, { error: 'Not a delivery signed by this server\u2019s GitHub App.' });
        const event = req.headers['x-github-event'];
        const payload = deliveryPayload(body, req.headers['content-type']) as (ReturnType<typeof deliveryPayload> & { action?: string; installation?: { id?: number; account?: { login?: string } }; repositories_added?: { full_name: string }[] }) | undefined;
        if (!payload) return send(res, 400, { error: 'The delivery is not JSON.' });
        const installation = payload.installation?.id;
        const workspace = github.workspaceOf(installation);
        if (event === 'ping') return send(res, 200, { result: { recorded: false, reason: 'pong' } });
        if (event === 'installation' && payload.action === 'deleted' && installation !== undefined) {
          github.forget(installation);
          return send(res, 200, { result: { recorded: true, forgotten: installation } });
        }
        if (!workspace || !workspaces.has(workspace)) return send(res, 200, { result: { recorded: false, reason: 'No workspace here has connected this installation. Connect GitHub from the Workspace screen.' } });
        res.once('close', workspaces.hold(workspace));
        const { lattice } = await workspaces.get(workspace);
        if (event === 'installation_repositories') return send(res, 200, { result: await addRepositories(lattice, (payload.repositories_added ?? []).map((r) => r.full_name), payload.installation?.account?.login ?? '') });
        if (event !== 'push') return send(res, 200, { result: { recorded: false, reason: `Only pushes are taken in, not "${event}".` } });
        const deliveryId = req.headers['x-github-delivery'];
        const taken = await receivePush(lattice, payload, typeof deliveryId === 'string' ? deliveryId : undefined);
        // A push of commits to a branch is then read against the map, by the agent on this server. GitHub is not
        // kept waiting for that: it is answered now, and the run says what it did when it is over.
        const reading = Boolean(taken.recorded && taken.repo && taken.branch && !taken.deleted && taken.commits && payload.after && payload.repository?.full_name) && (await hasReaderKey(lattice));
        if (reading) {
          const release = workspaces.hold(workspace);
          void readPush(lattice, github, { installation: String(installation), name: payload.repository!.full_name!, entity: taken.repo! }, { branch: taken.branch!, default_branch: payload.repository!.default_branch ?? taken.branch!, before: payload.before ?? '0', after: payload.after! })
            .then((r) => console.log(`reader: ${payload.repository!.full_name} ${payload.after!.slice(0, 7)}: ${r.ran ? `${r.ok ? 'done' : 'failed'}, ${r.tokens} tokens` : r.reason}`))
            .catch((err) => console.error(`reader: ${(err as Error).message}`))
            .finally(release);
        }
        return send(res, 200, { result: { ...taken, reading } });
      }

      // GitHub's deliveries carry no token: the signature over the body is who
      // they are from, made with the secret this workspace gave GitHub.
      const delivery = req.method === 'POST' ? /^\/github\/([^/]+)$/.exec(url.pathname) : null;
      if (delivery) {
        const id = decodeURIComponent(delivery[1]);
        const body = await readBody(req);
        const refused = () => send(res, 401, { error: 'Not a delivery signed for this workspace.' });
        if (!workspaces.has(id)) return refused();
        res.once('close', workspaces.hold(id));
        const { lattice } = await workspaces.get(id);
        if (!(await signedByGithub(lattice, body, req.headers['x-hub-signature-256']))) return refused();
        const event = req.headers['x-github-event'];
        if (event !== 'push') return send(res, 200, { result: { recorded: false, reason: event === 'ping' ? 'pong' : `Only pushes are taken in, not "${event}".` } });
        const payload = deliveryPayload(body, req.headers['content-type']);
        if (!payload) return send(res, 400, { error: 'The delivery is not JSON, nor a form with JSON in its "payload" field. Set the webhook\'s content type to application/json.' });
        const deliveryId = req.headers['x-github-delivery'];
        return send(res, 200, { result: await receivePush(lattice, payload, typeof deliveryId === 'string' ? deliveryId : undefined) });
      }

      if (req.method === 'POST' && url.pathname.startsWith('/hooks/')) {
        // Never from a web page, and only under a name this server answers to; with tokens on, the token says whose session it is.
        if (req.headers.origin || !hosts.includes(req.headers.host ?? '')) return send(res, 403, { error: 'Hooks are called by Claude Code, not from a web page, and at an address this server is known by.' });
        const { lattice } = await resolve(req, res, 'agent');
        const body = ((await readJson(req)) ?? {}) as { session_id?: string; cwd?: string; remote?: string; reason?: string; tokens?: number; setup?: string };
        // Said in the server's log, so "did the hook run?" has an answer.
        console.log(`hook ${url.pathname.slice('/hooks/'.length)} from session ${body.session_id ?? 'unknown'}`);
        // Each time the owner sends a session a message, the session is told what
        // the owner has done in the map since it last heard: a decision made
        // in the UI reaches the session with the next thing they say.
        // The hook counts what the session has used so far; it is recorded before anything else, so an ending session's last tokens reach its work.
        if (url.pathname !== '/hooks/session-start') await recordUsage(lattice, body.session_id, body.tokens).catch((err) => console.error(`hook usage: ${(err as Error).message}`));
        if (url.pathname === '/hooks/prompt') {
          await sessionHeard(lattice, body.session_id).catch((err) => console.error(`hook heard: ${(err as Error).message}`));
          const key = body.session_id ?? '';
          const heard = heardUpTo.get(key);
          const changes = heard === undefined ? [] : await humanChanges(lattice, heard);
          heardUpTo.set(key, changes.at(-1)?.seq ?? heard ?? (await latestSeq(lattice)));
          const told: string[] = [];
          // A session this server has no memory of, though it began before the server did, has lived through a
          // restart: after a deploy its client still holds the tools as they were when it connected. Said once.
          const began = heard === undefined ? await sessionBegan(lattice, body.session_id) : undefined;
          if (began && began.getTime() < Date.parse(running.started))
            told.push(
              `The Lattice server has restarted since this session began (at ${running.started}${running.commit ? `, now running commit ${running.commit.slice(0, 7)}` : ''}). If that was a deploy, its tools may have changed, and your client still holds the list from when it connected: a tool or an input that CLAUDE.md or a tool's answer names, but your list lacks, is there on the server. Ask the owner to reconnect the lattice MCP server, or until then call the tool as plain JSON: POST /agent/<tool> on the same server with the same token.`,
            );
          if (changes.length) told.push(`Since you last heard from Lattice, the owner did this in the map (web UI or CLI). Take it into account, and act on it if it is addressed to you:\n${describeChanges(changes)}`);
          if (!told.length) return send(res, 200, {});
          return send(res, 200, { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: told.join('\n\n') } });
        }
        if (url.pathname === '/hooks/session-start') {
          heardUpTo.set(body.session_id ?? '', await latestSeq(lattice));
          let additionalContext = await hookSessionStart(lattice, body);
          // A project keeps the files it was given when it was set up; the server moves on. A session is told when its
          // project is behind, since nothing else would: an old hook counts less, and old rules name tools as they were.
          if (body.setup !== SETUP_VERSION) {
            const host = req.headers.host ?? '';
            additionalContext += `\n\nThis folder's Lattice files (hooks, working rules, the bump skill) are older than the server's. Tell the owner in your first reply, and with their yes bring them up to date by running this in the folder (it holds no secret, and only adds to what is there): ${setupCommand(`${named.includes(host) ? 'https' : 'http'}://${host}`)} . What it changes takes effect in the next session.`;
          }
          return send(res, 200, { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } });
        }
        if (url.pathname === '/hooks/session-end') {
          await hookSessionEnd(lattice, body);
          return send(res, 200, {});
        }
        // The end of a turn: nothing to say back, but the session was heard from and its count (taken above) is
        // up to date, so one long turn does not go a whole session without its tokens.
        if (url.pathname === '/hooks/stop') {
          await sessionHeard(lattice, body.session_id).catch((err) => console.error(`hook heard: ${(err as Error).message}`));
          return send(res, 200, {});
        }
      }

      // The operator runs the installation: they create workspaces and hand
      // each one its first human token. They cannot read any workspace's map.
      // A workspace whose owner has lost their token gets a new one from the
      // operator. It does not revoke the old one: the owner does that once in.
      const reissue = tokens && req.method === 'POST' ? /^\/operator\/workspaces\/([^/]+)\/owner-token$/.exec(url.pathname) : null;
      if (reissue) {
        if (!local(req)) return send(res, 403, { error: 'Local requests only.' });
        if (!workspaces.isOperator(bearer(req.headers.authorization))) return send(res, 401, { error: 'The operator secret is required.' });
        const id = decodeURIComponent(reissue[1]);
        if (!workspaces.has(id)) return send(res, 404, { error: `No workspace "${id}"` });
        return send(res, 200, { result: await ownerToken(await workspaces.get(id), 'owner (reissued)') });
      }
      if (tokens && req.method === 'POST' && url.pathname === '/operator/reset') {
        // Only from the server's own machine, by its local name, and never through a browser.
        const here = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && hosts.slice(0, 2).includes(req.headers.host ?? '');
        if (req.headers.origin || !here) return send(res, 403, { error: 'Only from the machine the server runs on.' });
        const secret = workspaces.resetOperator(((await readJson(req)) as { proof?: string } | undefined)?.proof);
        if (!secret) return send(res, 401, { error: 'No reset was prepared, or the proof does not match.' });
        console.log('The operator secret was replaced from this machine.');
        return send(res, 200, { result: { operator_secret: secret, note: 'Keep this secret now: it is not stored and cannot be shown again. The old one no longer works.' } });
      }
      if (url.pathname === '/operator/workspaces' && tokens) {
        if (!local(req, req.method === 'POST')) return send(res, 403, { error: 'Local requests only.' });
        if (!workspaces.isOperator(bearer(req.headers.authorization))) return send(res, 401, { error: 'The operator secret is required.' });
        if (req.method === 'GET') return send(res, 200, { result: workspaces.list() });
        if (req.method === 'POST') {
          // `backup` is a backup file's bytes in base64: the workspace starts as that map.
          const { id, name, backup } = ((await readJson(req)) ?? {}) as { id?: string; name?: string; backup?: string };
          try {
            const from = backup === undefined ? undefined : parseBackup(Buffer.from(String(backup), 'base64'));
            const ws = await workspaces.create(id ?? '', name ?? '', from);
            const owner = await ownerToken(ws, 'owner');
            if (!from) return send(res, 200, { result: owner });
            const { rows } = await ws.lattice.db.query<{ entities: number; events: number }>(`select (select count(*)::int from entity) as entities, (select count(*)::int from event) as events`);
            return send(res, 200, { result: { ...owner, restored: { from: from.workspace, taken: from.taken, ...rows[0] } } });
          } catch (err) {
            return send(res, 400, { error: (err as Error).message });
          }
        }
      }

      send(res, 404, { error: 'Not found' });
    } catch (err) {
      if (res.headersSent) return void res.end();
      if (err instanceof Refused) return send(res, err.status, { error: err.message });
      send(res, 500, { error: (err as Error).message });
    }
  });
}

if (import.meta.main) {
  const config = loadConfig();
  const rootDir = join(config.dataDir, '..', 'workspaces');
  // Before anything reads a secret: where the key they are sealed with is kept.
  configureSecrets(rootDir);
  const workspaces = new Workspaces({ dataDir: config.dataDir, rootDir, packsDir: config.packsDir, packs: config.packs, policy: config.policy, runAutomations: true });
  if (config.launch) configureLauncher({ mcpUrl: `http://127.0.0.1:${config.port}/mcp`, dir: join(config.dataDir, '..', 'runs'), command: ['claude'], auth: config.auth === 'tokens' });

  // One server per data folder, whatever port each is on: two of them writing
  // the same database files destroy it. The lock names the process that has it.
  const lock = `${config.dataDir}.lock`;
  // The machine is named too: in a container process ids start over, so a lock
  // left by the last container would otherwise look like a live process.
  const me = `${process.pid}@${hostname()}`;
  const [pid, machine] = existsSync(lock) ? readFileSync(lock, 'utf8').split('@') : [];
  const holder = machine === undefined || machine === hostname() ? Number(pid) || 0 : 0;
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  };
  if (holder && holder !== process.pid && alive(holder)) {
    console.error(`${config.dataDir} is in use by another lattice server (process ${holder}). Stop it first. No data was opened.
If that process is not a lattice server, delete ${lock}.`);
    process.exit(1);
  }

  // The GitHub App is told this server's address: the name it is reached by from outside, when it has one.
  const origin = config.publicHosts[0] ? `https://${config.publicHosts[0]}` : `http://127.0.0.1:${config.port}`;
  const githubApp = new GithubApp({ dir: rootDir, origin });
  const server = createHttpServer(workspaces, config.port, { auth: config.auth, publicHosts: config.publicHosts, github: githubApp });
  // Every hour each workspace that connected GitHub is asked, for each repository the app can read, whether a
  // re-check is due (each project says how often); the agent on this server does the ones that are. An hour when
  // nothing is due costs no run. Asked that often because a server that is deployed daily never sees a whole day.
  const recheckAll = async () => {
    for (const { id } of workspaces.list()) {
      const installation = githubApp.installationOf(id);
      if (!installation) continue;
      const release = workspaces.hold(id);
      try {
        const { lattice } = await workspaces.get(id);
        for (const repo of await readable(lattice, githubApp, installation.id)) {
          const about = (await githubApp.asInstallation(installation.id, `/repos/${repo.name}`)) as { default_branch?: string };
          const r = await recheck(lattice, githubApp, repo, about.default_branch ?? 'main');
          if (r.ran) console.log(`reader: re-check of ${repo.name}: ${r.ok ? 'done' : 'failed'}, ${r.tokens} tokens`);
        }
      } catch (err) {
        console.error(`reader: re-check in ${id} failed: ${(err as Error).message}`);
      } finally {
        release();
      }
    }
  };
  const rechecks = setInterval(() => void recheckAll(), 3600_000);
  rechecks.unref();
  setTimeout(() => void recheckAll(), 120_000).unref();
  // A push whose reading was cut off when the last server stopped is read by this one, soon after it is up.
  const readLeftUnread = async () => {
    for (const { id } of workspaces.list()) {
      const installation = githubApp.installationOf(id);
      if (!installation) continue;
      const release = workspaces.hold(id);
      try {
        const { lattice } = await workspaces.get(id);
        for (const r of await readUnread(lattice, githubApp, installation.id)) console.log(`reader: caught up on ${r.repo} ${r.branch} (${r.after.slice(0, 7)})`);
      } catch (err) {
        console.error(`reader: catching up in ${id} failed: ${(err as Error).message}`);
      } finally {
        release();
      }
    }
  };
  setTimeout(() => void readLeftUnread(), 20_000).unref();
  // The port is taken before any database is opened: a second server started
  // by mistake must fail here, never open data another server is writing.
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is in use: another lattice server is probably running. Stop it first. No data was opened.` : err.message);
    process.exit(1);
  });
  server.listen(config.port, config.host, async () => {
    writeFileSync(lock, me);
    const main = await workspaces.get(DEFAULT_WORKSPACE);
    console.log(`lattice listening on http://${config.host}:${config.port}  (MCP at /mcp)`);
    if (config.publicHosts.length) console.log(`answering to: ${config.publicHosts.join(', ')}`);
    console.log(`data: ${config.dataDir}`);
    console.log(`packs: ${main.lattice.registry.packs.map((p) => `${p.id}@${p.version}`).join(', ')}`);
    console.log(`auth: ${config.auth}`);
    if (config.dev) console.log('dev mode: agent changes are not reviewed, and agents can restart the server');
    if (config.idleMinutes > 0) {
      console.log(`workspaces unused for ${config.idleMinutes} minutes are closed until next needed`);
      idle = setInterval(() => void workspaces.closeIdle(config.idleMinutes * 60_000).then((closed) => closed.length && console.log(`closed idle workspaces: ${closed.join(', ')}`), (err) => console.error('closing idle workspaces failed:', err)), 60_000);
    }
    if (config.backup) {
      const { dir, everyHours, keep, upload } = config.backup;
      console.log(`backups: every ${everyHours} hours to ${dir}, keeping ${keep}${upload ? ', each copied off the server' : ' (NOT copied off the server)'}`);
      // Asked every few minutes whether one is due, going by the newest file,
      // so restarting the server neither skips a backup nor piles them up.
      const check = async () => {
        const newest = newestBackup(dir);
        if (newest && Date.now() - newest.getTime() < everyHours * 3600_000) return;
        for (const r of await backupAll(workspaces, dir, keep, upload)) {
          if (r.error) console.error(`backup of ${r.workspace} FAILED: ${r.error}`);
          else if (r.copied === false) console.error(`backed up ${r.workspace}: ${r.rows} rows, but the copy off the server FAILED: ${r.copy_error}`);
          else console.log(`backed up ${r.workspace}: ${r.rows} rows${r.copied ? ', copied off the server' : ''}`);
        }
      };
      configureBackup(() => backupAll(workspaces, dir, keep, upload));
      const safely = () => void check().catch((err) => console.error('backup failed:', err));
      safely();
      backups = setInterval(safely, 5 * 60_000);
    }
    if (config.auth !== 'tokens') return;
    // First start with tokens on: there is nobody to ask for a token yet, so
    // make the two that everything else is created from, and show them once.
    const operator = workspaces.ensureOperator();
    if (operator) console.log(`\nOperator secret (creates workspaces; shown once):\n  ${operator}`);
    if (!(await hasHumanToken(main.lattice.db))) {
      const owner = await createToken(main.lattice.db, DEFAULT_WORKSPACE, { kind: 'human', name: 'owner', admin: true });
      console.log(`\nYour token for the default workspace (shown once):\n  ${owner.token}\nPaste it into the web UI, and set LATTICE_TOKEN for the CLI.`);
    }
  });
  let backups: ReturnType<typeof setInterval> | undefined;
  let idle: ReturnType<typeof setInterval> | undefined;
  const stop = async (code = 0) => {
    clearInterval(backups);
    clearInterval(idle);
    stopAllLaunched();
    server.close();
    await workspaces.closeAll();
    rmSync(lock, { force: true });
    process.exit(code);
  };
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
  // Leave time for the answer to the restart call to be sent, then hand over to src/dev.ts.
  if (config.dev) configureRestart(() => void setTimeout(() => stop(RESTART_EXIT), 200));
}
