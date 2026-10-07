// One local process owns the databases and serves every surface:
//   POST /mcp          MCP (streamable HTTP) for agents
//   POST /api/<tool>   the same tools for the human CLI and web UI
//   POST /agent/<tool> the same tools as plain JSON, for hooks and scripts
//                      that cannot speak MCP
//   POST /hooks/session-start, /hooks/session-end
//                      Claude Code HTTP hooks: a session registers itself and
//                      is handed what the map knows about its repository
//   GET  /whoami       which workspace and identity a request resolves to
//   /operator/workspaces  list and create workspaces (operator secret)
//   GET  /             the web UI
// It listens on 127.0.0.1 only.
//
// Who is calling is decided one of two ways. With auth off (the default, for
// one person on one machine) there is a single workspace and the surface
// decides: /api is the human, everything else an agent. With auth "tokens",
// every request carries a token that names its workspace and its identity,
// and the surface no longer matters.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { z } from 'zod';
import { bearer, createToken, hasHumanToken, verifyToken, workspaceOf } from './auth.ts';
import { loadConfig, RESTART_EXIT } from './config.ts';
import { configureLauncher, stopAllLaunched } from './launcher.ts';
import type { Actor, Lattice } from './lattice.ts';
import { configureOutbox } from './outbox.ts';
import { hookSessionEnd, hookSessionStart } from './sessions.ts';
import { callTool, configureRestart, devMode, TOOLS } from './tools.ts';
import { DEFAULT_WORKSPACE, Workspaces, type Workspace } from './workspaces.ts';

const actorField = {
  actor: z.string().optional().describe('Who you are, e.g. "claude-code:aperture". Recorded against everything you do.'),
};

function buildMcp(lattice: Lattice, actorFor: (label?: string) => Actor): McpServer {
  const mcp = new McpServer({ name: 'lattice', version: '0.1.0' });
  for (const [name, tool] of Object.entries(TOOLS)) {
    if (tool.humanOnly || (tool.devOnly && !devMode())) continue;
    mcp.registerTool(name, { description: tool.description, inputSchema: { ...tool.input, ...actorField } }, async (args: Record<string, unknown>) => {
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

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
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
};
const MIME: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css' };

class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createHttpServer(workspaces: Workspaces, port: number, options: { auth?: 'off' | 'tokens' } = {}): Server {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const origins = hosts.map((h) => `http://${h}`);
  const tokens = options.auth === 'tokens';
  configureOutbox(async (id) => (workspaces.has(id) ? (await workspaces.get(id)).lattice : undefined));

  /** The workspace a request is for and who is making it. */
  async function resolve(req: IncomingMessage, surface: 'human' | 'agent'): Promise<{ ws: Workspace; lattice: Lattice; actor: (label?: string) => Actor }> {
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
    const ws = await workspaces.get(id);
    const identity = await verifyToken(ws.lattice.db, token);
    if (!identity) throw denied;
    // A token's identity is fixed; an agent may add a label to say which session it is.
    return {
      ws,
      // Everything this request reads or writes goes through the database as
      // this person sees it. A token tied to nobody sees only what is shared.
      lattice: ws.lattice.as(identity.actor.person ?? ''),
      actor: (label) => (label && identity.actor.kind === 'agent' ? { ...identity.actor, name: `${identity.actor.name}/${label}` } : identity.actor),
    };
  }

  /** Keep other web pages out: only our own UI's origin, only JSON, only our host name. */
  const local = (req: IncomingMessage, needJson = true) =>
    !(req.headers.origin && !origins.includes(req.headers.origin)) && hosts.includes(req.headers.host ?? '') && (!needJson || Boolean(req.headers['content-type']?.startsWith('application/json')));

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, name: 'lattice' });

      if (req.method === 'GET' && UI_FILES[url.pathname]) {
        const file = UI_FILES[url.pathname];
        res.writeHead(200, { 'content-type': `${MIME[file.split('.').pop()!]}; charset=utf-8`, 'cache-control': 'no-store' });
        return res.end(await readFile(join(UI_DIR, file)));
      }

      if (req.method === 'GET' && url.pathname === '/whoami') {
        if (!local(req, false)) return send(res, 403, { error: 'Local requests only.' });
        const { ws, actor } = await resolve(req, 'human');
        return send(res, 200, { auth: tokens ? 'tokens' : 'off', dev: devMode(), workspace: { id: ws.id, name: ws.name }, actor: actor() });
      }

      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, { error: 'This server is stateless: POST only.' });
        const { lattice, actor } = await resolve(req, 'agent');
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
        const { lattice, actor } = await resolve(req, surface === 'api' ? 'human' : 'agent');
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

      if (req.method === 'POST' && url.pathname.startsWith('/hooks/')) {
        if (req.headers.origin || !hosts.includes(req.headers.host ?? '')) return send(res, 403, { error: 'Hooks are local only.' });
        const { lattice } = await resolve(req, 'agent');
        const body = ((await readJson(req)) ?? {}) as { session_id?: string; cwd?: string; reason?: string };
        if (url.pathname === '/hooks/session-start') {
          const additionalContext = await hookSessionStart(lattice, body);
          return send(res, 200, { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } });
        }
        if (url.pathname === '/hooks/session-end') {
          await hookSessionEnd(lattice, body);
          return send(res, 200, {});
        }
      }

      // The operator runs the installation: they create workspaces and hand
      // each one its first human token. They cannot read any workspace's map.
      if (url.pathname === '/operator/workspaces' && tokens) {
        if (!local(req, req.method === 'POST')) return send(res, 403, { error: 'Local requests only.' });
        if (!workspaces.isOperator(bearer(req.headers.authorization))) return send(res, 401, { error: 'The operator secret is required.' });
        if (req.method === 'GET') return send(res, 200, { result: workspaces.list() });
        if (req.method === 'POST') {
          const { id, name } = ((await readJson(req)) ?? {}) as { id?: string; name?: string };
          try {
            const ws = await workspaces.create(id ?? '', name ?? '');
            const owner = await createToken(ws.lattice.db, ws.id, { kind: 'human', name: 'owner', admin: true });
            return send(res, 200, { result: { workspace: { id: ws.id, name: ws.name }, owner_token: owner.token, note: owner.note } });
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
  const workspaces = new Workspaces({ dataDir: config.dataDir, rootDir, packsDir: config.packsDir, packs: config.packs, policy: config.policy, runAutomations: true });
  configureLauncher({ mcpUrl: `http://127.0.0.1:${config.port}/mcp`, dir: join(config.dataDir, '..', 'runs'), command: ['claude'], auth: config.auth === 'tokens' });

  const server = createHttpServer(workspaces, config.port, { auth: config.auth });
  // The port is taken before any database is opened: a second server started
  // by mistake must fail here, never open data another server is writing.
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is in use: another lattice server is probably running. Stop it first. No data was opened.` : err.message);
    process.exit(1);
  });
  server.listen(config.port, '127.0.0.1', async () => {
    const main = await workspaces.get(DEFAULT_WORKSPACE);
    console.log(`lattice listening on http://127.0.0.1:${config.port}  (MCP at /mcp)`);
    console.log(`data: ${config.dataDir}`);
    console.log(`packs: ${main.lattice.registry.packs.map((p) => `${p.id}@${p.version}`).join(', ')}`);
    console.log(`auth: ${config.auth}`);
    if (config.dev) console.log('dev mode: agent changes are not reviewed, and agents can restart the server');
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
  const stop = async (code = 0) => {
    stopAllLaunched();
    server.close();
    await workspaces.closeAll();
    process.exit(code);
  };
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
  // Leave time for the answer to the restart call to be sent, then hand over to src/dev.ts.
  if (config.dev) configureRestart(() => void setTimeout(() => stop(RESTART_EXIT), 200));
}
