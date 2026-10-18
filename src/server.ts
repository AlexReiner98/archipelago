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
//   POST /operator/reset  replace a lost operator secret (`pelago operator-reset`)
//   GET  /             the web UI
// It listens on 127.0.0.1 unless told otherwise, and beyond it only with tokens on.
//
// Who is calling is decided one of two ways. With auth off (the default, for
// one person on one machine) there is a single workspace and the surface
// decides: /api is the human, everything else an agent. With auth "tokens",
// every request carries a token that names its workspace and its identity,
// and the surface no longer matters.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { bearer, createToken, hasHumanToken, verifyToken, workspaceOf } from './auth.ts';
import { notify } from './notify.ts';
import { backupAll, parseBackup } from './backup.ts';
import { loadConfig, RESTART_EXIT, startedFrom } from './config.ts';
import { setupScript } from './connect.ts';
import { deliveryPayload, receivePush, signedByGithub } from './github.ts';
import { addRepositories, GithubApp } from './github-app.ts';
import { configureLauncher, stopAllLaunched } from './launcher.ts';
import { serveHook } from './hooks.ts';
import { serveMcp } from './mcp.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { configureOutbox } from './outbox.ts';
import { hasReaderKey, readPush } from './reader.ts';
import { pgLeader, soleLeader, type Leader } from './leader.ts';
import { serverDuties } from './duties.ts';
import { clientAddress, trustedProxies } from './address.ts';
import { DELIVERY_LIMIT, limiter, PUBLIC_LIMIT, REFUSED_LIMIT, type Limit } from './limit.ts';
import { publicPage, publicPicture } from './public.ts';
import { sharedDocument, sharedPicture } from './documents.ts';
import { configureSecrets } from './secrets.ts';
import { serveBackupFile } from './backup-tools.ts';
import { answerHook } from './hook-answers.ts';
import { callTool, configureBackup, configureGithubApp, configureRestart, devMode } from './tools.ts';
import { UI_FILES } from './ui-files.ts';
import { DEFAULT_WORKSPACE, Workspaces, type Workspace } from './workspaces.ts';

/** The most a request may carry: GitHub's largest delivery is 25 MB, and a backup sent as base64 is the other large thing. */
const BODY_MAX = 32_000_000;

/** A request's body, refused once it is larger than any honest one: some routes read it before they know who sent it. */
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const tooLarge = () => new Refused(413, `A request may carry ${BODY_MAX / 1_000_000} MB at most.`);
  if (Number(req.headers['content-length'] ?? 0) > BODY_MAX) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_MAX) throw tooLarge();
    chunks.push(chunk as Buffer);
  }
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
// The page itself: its own script and stylesheet, this server, and the one frame a style's code is drawn in.
const PAGE_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
// The frame a style's code runs in. `sandbox` gives it an origin of its own, so it has no way to the page's token or storage, cannot open
// windows or move the page, and `connect-src 'none'` with no outside source for anything leaves it nowhere to send what it is shown.
// It does not say who may frame it: sandboxed, it has no origin for 'self' to match, and framed by a stranger it is an empty page that can reach nothing.
const DRAW_POLICY = "sandbox allow-scripts; default-src 'none'; script-src 'self' blob: data:; worker-src blob: data:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; webrtc 'block'; base-uri 'none'; form-action 'none'";
const MIME: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css' };

class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export { lenient } from './mcp.ts';

export function createHttpServer(workspaces: Workspaces, port: number, options: { auth?: 'off' | 'tokens'; publicHosts?: string[]; github?: GithubApp; limits?: { open?: Limit; deliveries?: Limit; refused?: Limit }; proxies?: string; leading?: () => boolean } = {}): Server {
  // The names this server answers to. A request for any other host is refused,
  // which is what stops another web page from reaching it through the browser.
  const named = options.publicHosts ?? [];
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...named];
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...named.map((name) => `https://${name}`)];
  const tokens = options.auth === 'tokens';
  configureOutbox(async (id) => (workspaces.has(id) ? (await workspaces.get(id)).pelago : undefined));
  const github = options.github;
  configureGithubApp(github);

  // Which code this is and since when: after a push the old server goes on answering until the new one is up.
  const running = { commit: startedFrom(), started: new Date().toISOString() };

  // What answers without a token is counted by address: the public pages and the setup script, and GitHub's deliveries.
  const open = limiter(options.limits?.open ?? PUBLIC_LIMIT);
  const deliveries = limiter(options.limits?.deliveries ?? DELIVERY_LIMIT);
  // A token that is refused is counted too: finding one wrong can mean opening a workspace's database first.
  const refusedTokens = limiter(options.limits?.refused ?? REFUSED_LIMIT);
  /** Where a request came from: what the proxies we trust say, not what the caller wrote ahead of them (src/address.ts). */
  const trusted = trustedProxies(options.proxies);
  const addressOf = (req: IncomingMessage) => clientAddress(req.headers['x-forwarded-for'], req.socket.remoteAddress, trusted);
  /** True, and the request answered, when its address has asked too often. */
  const tooOften = (req: IncomingMessage, res: ServerResponse, count: ReturnType<typeof limiter>) => {
    const wait = count.take(addressOf(req));
    if (wait) res.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(wait) }).end(JSON.stringify({ error: `Asked too often. Try again in ${wait} seconds.` }));
    return wait > 0;
  };


  /** The workspace a request is for and who is making it. */
  async function resolve(req: IncomingMessage, res: ServerResponse, surface: 'human' | 'agent'): Promise<{ ws: Workspace; pelago: Archipelago; actor: (label?: string) => Actor }> {
    if (!tokens) {
      const ws = await workspaces.get(DEFAULT_WORKSPACE);
      return { ws, pelago: ws.pelago, actor: (label) => (surface === 'human' ? { kind: 'human', name: 'local', admin: true } : { kind: 'agent', name: label || 'claude' }) };
    }
    const token = bearer(req.headers.authorization);
    const id = token && workspaceOf(token);
    // The same answer whether the token is malformed, unknown, expired or for
    // a workspace that does not exist: nothing to probe.
    const address = addressOf(req);
    const wait = refusedTokens.full(address);
    if (wait) throw new Refused(429, `Too many requests from here were refused for their token. Try again in ${wait} seconds.`);
    const deny = () => {
      refusedTokens.take(address);
      return new Refused(401, 'A valid token is required. Send it as: Authorization: Bearer <token>');
    };
    if (!token || !id || !workspaces.has(id)) throw deny();
    // The workspace stays open for as long as this request lasts, however long that is.
    res.once('close', workspaces.hold(id));
    const ws = await workspaces.get(id);
    // Where the request came from is a help in noticing a token used somewhere new, not a control.
    const identity = await verifyToken(ws.pelago.db, token, address || undefined);
    if (!identity) throw deny();
    if (identity.newPlace)
      await notify(ws.pelago, { kind: 'agent', name: 'pelago' }, {
        title: `The token "${identity.actor.name}" was used from a new place`,
        body: `It was used from ${identity.newPlace}, where it had not been used before. A machine that has moved networks does this. If it is not one of yours, revoke the token on the Workspace screen: whoever has it can act as that ${identity.actor.kind}.`,
        level: 'warning',
      }).catch((err) => console.error(`notify: ${(err as Error).message}`));
    // A token's identity is fixed; an agent may add a label to say which session it is.
    return {
      ws,
      // Everything this request reads or writes goes through the database as
      // this person sees it. A token tied to nobody sees only what is shared.
      pelago: ws.pelago.as(identity.actor.person ?? '', Boolean(identity.actor.admin)),
      actor: (label) => (label && identity.actor.kind === 'agent' ? { ...identity.actor, name: `${identity.actor.name}/${label}` } : identity.actor),
    };
  }

  /**
   * A token with full control of a workspace, for the operator to hand over.
   * It is the owner's own when the workspace has one, so it sees what is
   * private to them: a map brought in from a backup arrives with its owner.
   */
  async function ownerToken(ws: Workspace, name: string) {
    const owner = await createToken(ws.pelago.db, ws.id, { kind: 'human', name, admin: true, entity: await ws.pelago.setting<string>('me') });
    return { workspace: { id: ws.id, name: ws.name }, owner_token: owner.token, note: owner.note };
  }

  /** Keep other web pages out: only our own UI's origin, only JSON, only our host name. */
  const local = (req: IncomingMessage, needJson = true) =>
    !(req.headers.origin && !origins.includes(req.headers.origin)) && hosts.includes(req.headers.host ?? '') && (!needJson || Boolean(req.headers['content-type']?.startsWith('application/json')));

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, name: 'pelago', ...running, leading: options.leading?.() ?? true });
      if (req.method === 'GET' && url.pathname.startsWith('/backup-file/')) {
        const [wsId, key] = url.pathname.slice(13).split('/');
        return await serveBackupFile(key && workspaces.has(wsId) ? (await workspaces.get(wsId)).pelago.db : undefined, key ?? '', res);
      }
      // What a project needs to work with this server, as one script to run in its folder. It holds no secret,
      // so it needs no token; it is given only under a name this server answers to, which it then writes down.
      if (req.method === 'GET' && url.pathname === '/connect/setup.mjs') {
        const host = req.headers.host ?? '';
        if (!hosts.includes(host)) return send(res, 404, { error: 'Not found' });
        if (tooOften(req, res, open)) return;
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(setupScript(`${named.includes(host) ? 'https' : 'http'}://${host}`, Boolean(tokens)));
      }

      // A product's public page: open to anyone, on any name this server has. It is read as the public role sees the
      // map, so there is nothing here to guard: what is not public is not there to be found.
      const pub = req.method === 'GET' ? /^\/p\/([^/]+)\/([^/]+)(?:\/(data|picture)(?:\/([^/]+))?)?\/?$/.exec(url.pathname) : null;
      if (pub) {
        if (tooOften(req, res, open)) return;
        const [, wsId, product, what, extra] = pub;
        const guard = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
        if (!what) {
          res.writeHead(200, { ...guard, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
          return res.end(await readFile(join(UI_DIR, 'public.html')));
        }
        const none = () => res.writeHead(404, { ...guard, 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
        if (!workspaces.has(wsId)) return none();
        const { pelago } = await workspaces.get(wsId);
        if (what === 'data') {
          const page = await publicPage(pelago, product, url.searchParams.get('build') ?? undefined);
          if (!page) return none();
          return res.writeHead(200, { ...guard, 'content-type': 'application/json', 'cache-control': 'public, max-age=30' }).end(JSON.stringify(page));
        }
        const picture = extra ? await publicPicture(pelago, extra) : null;
        if (!picture) return none();
        return res.writeHead(200, { ...guard, 'content-type': picture.content_type, 'cache-control': 'public, max-age=300', 'content-security-policy': "default-src 'none'" }).end(picture.bytes);
      }

      // A document given as a link: open to whoever holds it, with no login. The secret in the path is the only key, so
      // the page is never cached, never framed and never says where it was read from. What it shows is read through one
      // function that gives that document and what it brings in, and nothing else (src/db.ts).
      const shared = req.method === 'GET' ? /^\/s\/([^/]+)\/([^/]+?)(?:\/(data|picture)(?:\/([^/]+))?)?\/?$/.exec(url.pathname) : null;
      if (shared) {
        if (tooOften(req, res, open)) return;
        const [, wsId, secret, data, figure] = shared;
        const guard = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
        if (!data) {
          res.writeHead(200, { ...guard, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
          return res.end(await readFile(join(UI_DIR, 'doc.html')));
        }
        if (data === 'picture') {
          const picture = figure && workspaces.has(wsId) ? await sharedPicture((await workspaces.get(wsId)).pelago, secret, figure) : null;
          if (!picture) return res.writeHead(404, { ...guard, 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
          return res.writeHead(200, { ...guard, 'content-type': picture.content_type, 'content-security-policy': "default-src 'none'" }).end(picture.bytes);
        }
        const doc = workspaces.has(wsId) ? await sharedDocument((await workspaces.get(wsId)).pelago, secret) : null;
        if (!doc) return res.writeHead(404, { ...guard, 'content-type': 'application/json' }).end(JSON.stringify({ error: 'This link does not open anything: it may have been revoked.' }));
        return res.writeHead(200, { ...guard, 'content-type': 'application/json' }).end(JSON.stringify(doc));
      }

      // A document read by someone signed in, to print or save as a PDF: the same page a link opens, which reads the
      // document with the reader's own token. The page holds nothing; what it shows is what that token may see.
      if (req.method === 'GET' && /^\/read\/e_[a-z0-9]{8}\/?$/.test(url.pathname)) {
        res.writeHead(200, { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
        return res.end(await readFile(join(UI_DIR, 'doc.html')));
      }

      if (req.method === 'GET' && UI_FILES[url.pathname]) {
        const file = UI_FILES[url.pathname];
        // The page loads its own script and stylesheet and talks to this server: nothing else, from anywhere, and it is not framed.
        res.writeHead(200, {
          'content-type': `${MIME[file.split('.').pop()!]}; charset=utf-8`,
          'cache-control': file === 'three.module.min.js' ? 'public, max-age=604800' : 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          ...(file === 'index.html' && { 'content-security-policy': PAGE_POLICY }),
          ...(file === 'draw.html' && { 'content-security-policy': DRAW_POLICY }),
          // The frame has an origin of its own, so what it loads from here it loads as a stranger.
          ...((file === 'draw.js' || file === 'three.module.min.js') && { 'access-control-allow-origin': '*' }),
        });
        return res.end(await readFile(join(UI_DIR, file)));
      }

      if (req.method === 'GET' && url.pathname === '/whoami') {
        if (!local(req, false)) return send(res, 403, { error: 'Local requests only.' });
        const { ws, actor } = await resolve(req, res, 'human');
        return send(res, 200, { auth: tokens ? 'tokens' : 'off', dev: devMode(), workspace: { id: ws.id, name: ws.name }, actor: actor() });
      }

      // A pack's webhook: /hook/<pack>/<id> in the default workspace, /hook/<workspace>/<pack>/<id> in another.
      const hook = req.method === 'POST' && /^\/hook\/(?:([a-z0-9-]+)\/)?([a-z0-9_]+)\/([a-z0-9_.]+)$/.exec(url.pathname);
      if (hook) return workspaces.has(hook[1] ?? DEFAULT_WORKSPACE) ? await serveHook(req, res, (await workspaces.get(hook[1] ?? DEFAULT_WORKSPACE)).pelago, hook[2], hook[3]) : send(res, 410, { error: 'No such workspace.' });

      if (url.pathname === '/mcp') {
        const { ws, pelago, actor } = await resolve(req, res, 'agent');
        return await serveMcp(req, res, { workspace: ws.id, pelago, actor }, hosts, req.method === 'POST' ? await readJson(req) : undefined);
      }

      const surface = url.pathname.startsWith('/api/') ? 'api' : url.pathname.startsWith('/agent/') ? 'agent' : undefined;
      if (req.method === 'POST' && surface) {
        if (!local(req)) return send(res, 403, { error: 'The API accepts only local JSON requests from the CLI, hooks or the pelago UI.' });
        const { pelago, actor } = await resolve(req, res, surface === 'api' ? 'human' : 'agent');
        const name = url.pathname.slice(surface.length + 2);
        try {
          const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
          if (surface === 'api') return send(res, 200, { result: await callTool(pelago, actor(), name, body) });
          // Scripts say which one they are in the body, as MCP callers do in their arguments.
          const { actor: label, ...input } = body;
          return send(res, 200, { result: await callTool(pelago, actor((label as string) || 'script'), name, input) });
        } catch (err) {
          if (err instanceof Refused) throw err;
          return send(res, 400, { error: (err as Error).message });
        }
      }

      // The GitHub App. Someone is sent to GitHub and comes back to one of these three; what proves they
      // started here is the one-time word they carry (state), so no token is asked for.
      if (github && req.method === 'GET' && url.pathname.startsWith('/github/app/')) {
        if (tooOften(req, res, open)) return;
        const q = url.searchParams;
        const page = (status: number, html: string) => res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
        const back = () => res.writeHead(302, { location: '/#/workspace' }).end();
        try {
          if (url.pathname === '/github/app/new') return page(200, await github.createPage(q.get('state')));
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
              const { pelago } = await workspaces.get(workspace);
              await addRepositories(pelago, await github.repositories(id!), github.installationOf(workspace)?.account ?? '');
            } finally {
              release();
            }
            return back();
          }
        } catch (err) {
          return page(400, `<!doctype html><meta charset="utf-8"><body style="font: 15px system-ui; padding: 40px"><p>${(err as Error).message.replaceAll('<', '&lt;')}</p><p><a href="/#/workspace">Back to Archipelago</a></p>`);
        }
      }
      // Everything the app's installations do arrives here, signed with the app's secret; the installation says whose workspace it is for.
      if (github && req.method === 'POST' && url.pathname === '/github/app/hook') {
        if (tooOften(req, res, deliveries)) return;
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
        const { pelago } = await workspaces.get(workspace);
        if (event === 'installation_repositories') return send(res, 200, { result: await addRepositories(pelago, (payload.repositories_added ?? []).map((r) => r.full_name), payload.installation?.account?.login ?? '') });
        if (event !== 'push') return send(res, 200, { result: { recorded: false, reason: `Only pushes are taken in, not "${event}".` } });
        const deliveryId = req.headers['x-github-delivery'];
        const taken = await receivePush(pelago, payload, typeof deliveryId === 'string' ? deliveryId : undefined);
        // A push of commits to a branch is then read against the map, by the agent on this server. GitHub is not
        // kept waiting for that: it is answered now, and the run says what it did when it is over.
        const reading = Boolean(taken.recorded && taken.repo && taken.branch && !taken.deleted && taken.commits && payload.after && payload.repository?.full_name) && (await hasReaderKey(pelago));
        if (reading) {
          const release = workspaces.hold(workspace);
          void readPush(pelago, github, { installation: String(installation), name: payload.repository!.full_name!, entity: taken.repo! }, { branch: taken.branch!, default_branch: payload.repository!.default_branch ?? taken.branch!, before: payload.before ?? '0', after: payload.after! })
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
        if (tooOften(req, res, deliveries)) return;
        const id = decodeURIComponent(delivery[1]);
        const body = await readBody(req);
        const refused = () => send(res, 401, { error: 'Not a delivery signed for this workspace.' });
        if (!workspaces.has(id)) return refused();
        res.once('close', workspaces.hold(id));
        const { pelago } = await workspaces.get(id);
        if (!(await signedByGithub(pelago, body, req.headers['x-hub-signature-256']))) return refused();
        const event = req.headers['x-github-event'];
        if (event !== 'push') return send(res, 200, { result: { recorded: false, reason: event === 'ping' ? 'pong' : `Only pushes are taken in, not "${event}".` } });
        const payload = deliveryPayload(body, req.headers['content-type']);
        if (!payload) return send(res, 400, { error: 'The delivery is not JSON, nor a form with JSON in its "payload" field. Set the webhook\'s content type to application/json.' });
        const deliveryId = req.headers['x-github-delivery'];
        return send(res, 200, { result: await receivePush(pelago, payload, typeof deliveryId === 'string' ? deliveryId : undefined) });
      }

      if (req.method === 'POST' && url.pathname.startsWith('/hooks/')) {
        // Never from a web page, and only under a name this server answers to; with tokens on, the token says whose session it is.
        if (req.headers.origin || !hosts.includes(req.headers.host ?? '')) return send(res, 403, { error: 'Hooks are called by Claude Code, not from a web page, and at an address this server is known by.' });
        const { ws, pelago, actor } = await resolve(req, res, 'agent');
        const body = ((await readJson(req)) ?? {}) as { session_id?: string; cwd?: string; remote?: string; reason?: string; tokens?: number; setup?: string };
        const host = req.headers.host ?? '';
        const answer = await answerHook(url.pathname.slice('/hooks/'.length), { whole: ws.pelago.db, pelago, repos: actor().repos ?? [], body, running, origin: `${named.includes(host) ? 'https' : 'http'}://${host}` });
        if (answer) return send(res, 200, answer);
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
            const { rows } = await ws.pelago.db.query<{ entities: number; events: number }>(`select (select count(*)::int from entity) as entities, (select count(*)::int from event) as events`);
            return send(res, 200, { result: { ...owner, restored: { from: from.workspace, taken: from.taken, ...rows[0] } } });
          } catch (err) {
            return send(res, 400, { error: (err as Error).message });
          }
        }
      }

      send(res, 404, { error: 'Not found' });
    } catch (err) {
      if (res.headersSent) return void res.end();
      if (err instanceof Refused) {
        // The rest of a body that was too large is let go by, kept nowhere, for the second it takes the answer to
        // be read; then the connection is ended.
        if (err.status === 413) {
          req.resume();
          const socket = req.socket as IncomingMessage['socket'] | null; // gone already when the sender has hung up
          res.once('finish', () => setTimeout(() => socket?.destroy(), 1000).unref());
        }
        return send(res, err.status, { error: err.message });
      }
      send(res, 500, { error: (err as Error).message });
    }
  });
}

if (import.meta.main) {
  const config = loadConfig();
  const rootDir = join(config.dataDir, '..', 'workspaces');
  // Before anything reads a secret: where the key they are sealed with is kept.
  configureSecrets(rootDir);
  const workspaces = new Workspaces({ dataDir: config.dataDir, databaseUrl: config.databaseUrl, rootDir, packsDir: config.packsDir, packs: config.packs, policy: config.policy });
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
    console.error(`${config.dataDir} is in use by another pelago server (process ${holder}). Stop it first. No data was opened.
If that process is not a pelago server, delete ${lock}.`);
    process.exit(1);
  }

  // The GitHub App is told this server's address: the name it is reached by from outside, when it has one.
  const origin = config.publicHosts[0] ? `https://${config.publicHosts[0]}` : `http://127.0.0.1:${config.port}`;
  const githubApp = new GithubApp({ dir: rootDir, origin, store: async (id) => (workspaces.has(id) ? (await workspaces.get(id)).pelago.db : undefined) });
  const server = createHttpServer(workspaces, config.port, { auth: config.auth, publicHosts: config.publicHosts, github: githubApp, proxies: config.trustedProxies, leading: () => leader?.leading ?? false });
  // The port is taken before any database is opened: a second server started
  // by mistake must fail here, never open data another server is writing.
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is in use: another pelago server is probably running. Stop it first. No data was opened.` : err.message);
    process.exit(1);
  });
  server.listen(config.port, config.host, async () => {
    writeFileSync(lock, me);
    const main = await workspaces.get(DEFAULT_WORKSPACE);
    console.log(`pelago listening on http://${config.host}:${config.port}  (MCP at /mcp)`);
    if (config.publicHosts.length) console.log(`answering to: ${config.publicHosts.join(', ')}`);
    if (config.trustedProxies) console.log(`proxies trusted for a caller's address: private networks, ${config.trustedProxies}`);
    console.log(`data: ${config.dataDir}`);
    console.log(`packs: ${main.pelago.registry.packs.map((p) => `${p.id}@${p.version}`).join(', ')}`);
    console.log(`auth: ${config.auth}`);
    if (config.dev) console.log('dev mode: agent changes are not reviewed, and agents can restart the server');
    // Several servers may share a Postgres server: the one holding its lock runs the clocks (src/leader.ts).
    leader = config.databaseUrl ? await pgLeader(config.databaseUrl) : soleLeader();
    if (config.databaseUrl) console.log(leader.leading ? 'leading: this server runs the clocks' : 'following: another server runs the clocks');
    leader.onChange((on) => void workspaces.lead(on));
    await workspaces.lead(leader.leading);
    stopDuties = serverDuties(leader, workspaces, githubApp, config.backup);
    if (config.idleMinutes > 0) {
      console.log(`workspaces unused for ${config.idleMinutes} minutes are closed until next needed`);
      idle = setInterval(() => void workspaces.closeIdle(config.idleMinutes * 60_000).then((closed) => closed.length && console.log(`closed idle workspaces: ${closed.join(', ')}`), (err) => console.error('closing idle workspaces failed:', err)), 60_000);
    }
    if (config.backup) {
      const { dir, everyHours, keep, upload } = config.backup;
      console.log(`backups: every ${everyHours} hours to ${dir}, keeping ${keep}${upload ? ', each copied off the server' : ' (NOT copied off the server)'}`);
      configureBackup(() => backupAll(workspaces, dir, keep, upload));
    }
    if (config.auth !== 'tokens') return;
    // First start with tokens on: there is nobody to ask for a token yet, so
    // make the two that everything else is created from, and show them once.
    const operator = workspaces.ensureOperator();
    if (operator) console.log(`\nOperator secret (creates workspaces; shown once):\n  ${operator}`);
    if (!(await hasHumanToken(main.pelago.db))) {
      const owner = await createToken(main.pelago.db, DEFAULT_WORKSPACE, { kind: 'human', name: 'owner', admin: true });
      console.log(`\nYour token for the default workspace (shown once):\n  ${owner.token}\nPaste it into the web UI, and set PELAGO_TOKEN for the CLI.`);
    }
  });
  let idle: ReturnType<typeof setInterval> | undefined;
  let leader: Leader | undefined;
  let stopDuties = () => {};
  const stop = async (code = 0) => {
    stopDuties();
    clearInterval(idle);
    await leader?.stop();
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
