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
//   GET  /whoami       which workspace and identity a request resolves to
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
import { backupAll, newestBackup, parseBackup } from './backup.ts';
import { loadConfig, RESTART_EXIT } from './config.ts';
import { deliveryPayload, receivePush, signedByGithub } from './github.ts';
import { configureLauncher, stopAllLaunched } from './launcher.ts';
import type { Actor, Lattice } from './lattice.ts';
import { configureOutbox } from './outbox.ts';
import { hookSessionEnd, hookSessionStart } from './sessions.ts';
import { callTool, configureBackup, configureRestart, describeChanges, devMode, humanChanges, latestSeq, TOOLS } from './tools.ts';
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
};
const MIME: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css' };

class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createHttpServer(workspaces: Workspaces, port: number, options: { auth?: 'off' | 'tokens'; publicHosts?: string[] } = {}): Server {
  // The names this server answers to. A request for any other host is refused,
  // which is what stops another web page from reaching it through the browser.
  const named = options.publicHosts ?? [];
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...named];
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...named.map((name) => `https://${name}`)];
  const tokens = options.auth === 'tokens';
  configureOutbox(async (id) => (workspaces.has(id) ? (await workspaces.get(id)).lattice : undefined));

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

      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, name: 'lattice' });

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
        if (req.headers.origin || !hosts.includes(req.headers.host ?? '')) return send(res, 403, { error: 'Hooks are local only.' });
        const { lattice } = await resolve(req, res, 'agent');
        const body = ((await readJson(req)) ?? {}) as { session_id?: string; cwd?: string; reason?: string };
        // Each time the owner sends a session a message, the session is told what
        // the owner has done in the map since it last heard: a decision made
        // in the UI reaches the session with the next thing they say.
        if (url.pathname === '/hooks/prompt') {
          const key = body.session_id ?? '';
          const heard = heardUpTo.get(key);
          const changes = heard === undefined ? [] : await humanChanges(lattice, heard);
          heardUpTo.set(key, changes.at(-1)?.seq ?? heard ?? (await latestSeq(lattice)));
          if (!changes.length) return send(res, 200, {});
          const additionalContext = `Since you last heard from Lattice, the owner did this in the map (web UI or CLI). Take it into account, and act on it if it is addressed to you:\n${describeChanges(changes)}`;
          return send(res, 200, { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } });
        }
        if (url.pathname === '/hooks/session-start') {
          heardUpTo.set(body.session_id ?? '', await latestSeq(lattice));
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

  const server = createHttpServer(workspaces, config.port, { auth: config.auth, publicHosts: config.publicHosts });
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
