// One local process owns the databases and serves every surface:
//   POST /mcp          MCP (streamable HTTP) for agents
//   POST /api/<tool>   the same tools for the human CLI and web UI
//   POST /agent/<tool> what MCP offers as plain JSON, for hooks and scripts
//                      that cannot speak MCP; an old tool name still answers
//                      for one release, with moved_to naming its new call
//   POST /hooks/session-start, /hooks/session-end, /hooks/prompt
//                      Claude Code HTTP hooks: a session registers itself and
//                      is handed what the map knows about its repository
//   POST /hook/<workspace>/<pack>/<id>  a pack's webhook, signed with the
//                      secret the owner made for it
//   /x/<pack>/...      a server pack's pages, entries and webhooks (the GitHub
//                      App's too), and the addresses it had before
//   GET  /whoami      which workspace and identity a request resolves to
//   /connect/...       the setup script that connects a project (no secret in
//                      it), and a running system's request for its token
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
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { bearer, createToken, hashSecret, verifyToken, workspaceOf } from './auth.ts'; import { firstStart } from './first-start.ts';
import { notify } from './notify.ts';
import { backupAll, parseBackup, parseVault } from './backup.ts'; import { configureMembers, memberLimit } from './members.ts'; import { configureEnded, readEnded } from './ended.ts'; import { askedAs, configurePlan, requestWait, slowTokensAt, storageBytes, tooManyRequests } from './plan.ts';
import { loadConfig, RESTART_EXIT, startedFrom } from './config.ts';
import { env } from './env.ts';
import { serveConnect } from './connect.ts';
import { configureLauncher, stopAllLaunched } from './launcher.ts';
import { serveHook } from './hooks.ts';
import { serveMcp } from './mcp.ts';
import { LOOK_READS, passWorkspace, readPass, setLookOrigin } from './looks.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { configureOutbox } from './outbox.ts'; import { configureIndex, tokenKnown, unindexToken } from './control-index.ts';
import { serverPacksOf } from './server-host.ts'; import { configureConnections } from './connection-tools.ts'; import { setReach } from './pack-reach.ts'; import './agent-run.ts';
import { pgLeader, soleLeader, type Leader } from './leader.ts'; import { drained } from './drain.ts';
import { serverDuties } from './duties.ts';
import { clientAddress, trustedProxies } from './address.ts';
import { DELIVERY_LIMIT, limiter, PUBLIC_LIMIT, REFUSED_LIMIT, SIGN_IN_LIMIT, type Limit } from './limit.ts';
import { servePublic } from './public-route.ts'; import { serveSite, siteNav } from './site.ts';
import { previewOf } from './published-preview.ts'; import { lengthsSheet, pageLook } from './styles.ts';
import { sharedDocument, sharedPicture } from './documents.ts';
import { configureSecrets } from './secrets.ts';
import { serveBackupFile } from './backup-tools.ts';
import { answerHook } from './hook-answers.ts';
import { callTool, configureBackup, configureRestart, devMode, replacementOf } from './tools.ts';
import { UI_FILES, uiFile, uiPage } from './ui-files.ts';
import { DEFAULT_WORKSPACE, Workspaces, type Workspace } from './workspaces.ts';

/** The most a request may carry: GitHub's largest delivery is 25 MB, and a backup sent as base64 is the other large thing. */
const BODY_MAX = 32_000_000; /** What a route open to anyone takes: a form's worth, or a webhook's delivery. */ const OPEN_BODY_MAX = 64_000, HOOK_BODY_MAX = 1_000_000;

/** A request's body, refused once it is larger than any honest one: some routes read it before they know who sent it. */
async function readBody(req: IncomingMessage, most = BODY_MAX): Promise<Buffer> {
  const tooLarge = () => new Refused(413, `A request here may carry ${most >= 1_000_000 ? `${most / 1_000_000} MB` : `${most / 1000} kB`} at most.`);
  if (Number(req.headers['content-length'] ?? 0) > most) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > most) throw tooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage, most = BODY_MAX): Promise<unknown> {
  const text = (await readBody(req, most)).toString('utf8');
  try { return text ? JSON.parse(text) : undefined; } catch { throw new Refused(400, 'The body is not JSON.'); }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

// The page itself: its own script and stylesheet, this server, and the one frame a style's code is drawn in.
const PAGE_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
/** A document's preview, which this server's own page may frame, to read drafts on the canvas (ui/reader-frame.js). */
const PREVIEW_POLICY = PAGE_POLICY.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
// The frame a style's code runs in. `sandbox` gives it an origin of its own, so it has no way to the page's token or storage, cannot open
// windows or move the page, and `connect-src 'none'` with no outside source for anything leaves it nowhere to send what it is shown.
// It does not say who may frame it: sandboxed, it has no origin for 'self' to match, and framed by a stranger it is an empty page that can reach nothing.
const DRAW_POLICY = "sandbox allow-scripts; default-src 'none'; script-src 'self' blob: data:; worker-src blob: data:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; webrtc 'block'; base-uri 'none'; form-action 'none'";
const MIME: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css' };

class Refused extends Error {
  readonly status: number;
  readonly retry?: number;
  constructor(status: number, message: string, retry?: number) {
    super(message);
    this.status = status;
    this.retry = retry;
  }
}
export { lenient } from './mcp.ts';

export function createHttpServer(workspaces: Workspaces, port: number, options: { auth?: 'off' | 'tokens'; publicHosts?: string[]; sites?: Record<string, string>; limits?: { open?: Limit; deliveries?: Limit; refused?: Limit; token?: Limit; signIn?: Limit }; proxies?: string; leading?: () => boolean; unsandboxed?: boolean } = {}): Server {
  // The names this server answers to. A request for any other host is refused,
  // which is what stops another web page from reaching it through the browser.
  // The server's own Chrome may reach it by another name, from a container beside it (src/looks.ts).
  const lookAt = new URL(process.env.PELAGO_LOOK_ORIGIN ?? `http://127.0.0.1:${port}`);
  setLookOrigin(lookAt.origin);
  const [named, sites] = [options.publicHosts ?? [], options.sites ?? {}], hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...named, lookAt.host];
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...named.map((name) => `https://${name}`), lookAt.origin];
  const tokens = options.auth === 'tokens';
  configureOutbox(async (id) => ((await workspaces.has(id)) ? (await workspaces.get(id)).pelago : undefined));
  // The server packs are told the address this server is reached at from outside; a workspace's packs reach them as its connections (src/pack-reach.ts).
  const serverPacks = serverPacksOf(workspaces);
  serverPacks.origin = named[0] ? `https://${named[0]}` : `http://127.0.0.1:${port}`;
  configureConnections(serverPacks);
  setReach({ hold: (id) => workspaces.hold(id), connection: async (id, pack) => { const c = await serverPacks.connectionOf(pack, id); return c ? { id: c.id, account: c.account } : null; }, via: (id, pack, host, path) => serverPacks.lent(pack, host, id, path) });
  configureMembers({ origin: origins.at(-1)!, nameOf: async (id) => (await workspaces.list()).find((w) => w.id === id)?.name ?? id, limitOf: async (id) => (id === 'default' ? undefined : memberLimit((await workspaces.get('default')).pelago.db, id)) }); configureIndex(() => workspaces.control()); configureEnded(async (id) => (id === 'default' ? undefined : readEnded((await workspaces.get('default')).pelago.db, id))); configurePlan({ storageOf: async (id) => storageBytes((await workspaces.get(id)).pelago.db) }); slowTokensAt(options.limits?.token);

  // Which code this is and since when: after a push the old server goes on answering until the new one is up.
  const running = { commit: startedFrom(), started: new Date().toISOString() };

  // What answers without a token is counted by address: the public pages and the setup script, and GitHub's deliveries.
  const open = limiter(options.limits?.open ?? PUBLIC_LIMIT);
  const deliveries = limiter(options.limits?.deliveries ?? DELIVERY_LIMIT), signIn = limiter(options.limits?.signIn ?? SIGN_IN_LIMIT);
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
  async function resolve(req: IncomingMessage, res: ServerResponse, surface: 'human' | 'agent'): Promise<{ ws: Workspace; pelago: Archipelago; actor: (label?: string) => Actor; look?: true }> {
    // A look pass reads as the agent it was made for, for one drawing by this server's Chrome, and only through /api.
    const pass = bearer(req.headers.authorization), passFor = passWorkspace(pass);
    if (passFor) {
      const ws = surface === 'human' && (await workspaces.has(passFor)) ? await workspaces.get(passFor) : undefined;
      const as = ws && (await readPass(ws.pelago.db, pass!));
      if (!ws || !as) throw new Refused(401, 'This look pass is not good here, or has run out.');
      res.once('close', workspaces.hold(passFor));
      const pelago = as.viewer === null ? (tokens ? ws.pelago.as('') : ws.pelago) : ws.pelago.as(as.viewer);
      // It reads as the page does (answers whole, as a person's page has them), as the agent's person sees the map; it
      // writes nothing (LOOK_READS), so it never acts on anyone's authority.
      return { ws, pelago, actor: () => ({ kind: 'human', name: `${as.actor} (look)`, ...(as.viewer && { person: as.viewer }) }), look: true };
    }
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
    if (!token || !id || !(await workspaces.has(id))) throw deny();
    // A token nobody made for that workspace is refused before its database is opened (src/control-index.ts).
    const control = await workspaces.control(), every = async () => (await workspaces.list()).map((w) => ({ id: w.id, db: async () => (await workspaces.get(w.id)).pelago.db }));
    if (!(await tokenKnown(control, hashSecret(token), id, every))) throw deny();
    // The workspace stays open for as long as this request lasts, however long that is.
    res.once('close', workspaces.hold(id));
    const ws = await workspaces.get(id);
    // Where the request came from is a help in noticing a token used somewhere new, not a control.
    const identity = await verifyToken(ws.pelago.db, token, address || undefined, ws.pelago.workspace);
    if (!identity) {
      await unindexToken(control, hashSecret(token));
      throw deny();
    }
    const slow = await requestWait(ws.id, token, askedAs(identity.actor)); if (slow) throw new Refused(429, await tooManyRequests(ws.id, slow), slow);
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
      // A domain that serves a workspace's public site: its pages by address word (src/site.ts); the rest as on any name.
      const host = (req.headers.host ?? '').toLowerCase(), site = req.method === 'GET' ? sites[host] : undefined;
      if (site && (tooOften(req, res, open) || (await serveSite(res, url.pathname, { host, workspace: site, workspaces })))) return;
      if (req.method === 'GET' && url.pathname.startsWith('/backup-file/')) {
        if (tooOften(req, res, open)) return; // a guessed key would otherwise open the workspace it names, again and again
        const [wsId, key] = url.pathname.slice(13).split('/');
        return await serveBackupFile(key && (await workspaces.has(wsId)) ? (await workspaces.get(wsId)).pelago.db : undefined, key ?? '', res);
      }
      // What a project needs to work with this server, and a running system's request for its token: no token needed.
      // A server pack answers at the addresses it had before it was a pack, too (a GitHub App set up then still sends there).
      const packPath = serverPacks.aliased(url.pathname) ?? url.pathname;
      if (/^\/(connect|x)\//.test(packPath)) return await serveConnect(req, res, packPath, { hosts, named, tokens, fallback: DEFAULT_WORKSPACE, workspaces, tooOften: () => tooOften(req, res, /^\/x\/[^/]+\/hook\//.test(packPath) ? deliveries : /^\/connect\/(sign-in|code|join|signup)$/.test(packPath) ? signIn : open), body: () => readJson(req, OPEN_BODY_MAX), raw: () => readBody(req, HOOK_BODY_MAX) });

      // A public page (a product's, or a document's): open to anyone, on any name this server has (src/public-route.ts).
      const pub = req.method === 'GET' ? /^\/p\/([^/]+)\/([^/]+)(?:\/(data|picture|drawing|live)(?:\/([^/]+))?)?\/?$/.exec(url.pathname) : null;
      if (pub) return tooOften(req, res, open) || (await servePublic(res, { workspace: pub[1], id: pub[2], what: pub[3], extra: pub[4], build: url.searchParams.get('build') ?? undefined }, { workspaces, named, sites, from: addressOf(req) }));

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
          return res.end(await uiPage('doc.html'));
        }
        if (data === 'picture') {
          const picture = figure && (await workspaces.has(wsId)) ? await sharedPicture((await workspaces.get(wsId)).pelago, secret, figure) : null;
          if (!picture) return res.writeHead(404, { ...guard, 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
          return res.writeHead(200, { ...guard, 'content-type': picture.content_type, 'content-security-policy': "default-src 'none'" }).end(picture.bytes);
        }
        const doc = (await workspaces.has(wsId)) ? await sharedDocument((await workspaces.get(wsId)).pelago, secret) : null;
        if (!doc) return res.writeHead(404, { ...guard, 'content-type': 'application/json' }).end(JSON.stringify({ error: 'This link does not open anything: it may have been revoked.' }));
        return res.writeHead(200, { ...guard, 'content-type': 'application/json' }).end(JSON.stringify({ ...doc, ...(await pageLook((await workspaces.get(wsId)).pelago, doc)) }));
      }

      // A document read by someone signed in, to print or save as a PDF: the same page a link opens, which reads the
      // document with the reader's own token. The page holds nothing; what it shows is what that token may see.
      if (req.method === 'GET' && /^\/read\/e_[a-z0-9]{8}\/?$/.test(url.pathname)) {
        // Framed by this server's own page alone, to read a private document on the canvas (ui/reader-frame.js).
        res.writeHead(200, { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" });
        return res.end(await uiPage('doc.html'));
      }
      // A document's preview, for someone signed in: the published page, drawn from what publishing would freeze now
      // (src/published-preview.ts), its site's other pages each led to by their own preview.
      if (req.method === 'GET' && /^\/preview\/e_[a-z0-9]{8}\/?$/.test(url.pathname)) {
        res.writeHead(200, { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PREVIEW_POLICY });
        return res.end((await uiPage('doc.html')).replace('<html', options.unsandboxed ? '<html data-draw-sandbox="off"' : '<html'));
      }
      const preview = req.method === 'POST' ? /^\/preview\/(e_[a-z0-9]{8})\/data$/.exec(url.pathname) : null;
      if (preview) {
        if (!local(req)) return send(res, 403, { error: 'A preview is read by the pelago UI.' });
        const { ws, pelago } = await resolve(req, res, 'human');
        try {
          return send(res, 200, { result: await previewOf(pelago, preview[1], () => siteNav(workspaces, ws.id, (page) => `/preview/${page.id}`)) });
        } catch (err) {
          if (err instanceof Refused) throw err;
          return send(res, 400, { error: (err as Error).message });
        }
      }

      if (req.method === 'GET' && UI_FILES[url.pathname]) {
        const file = UI_FILES[url.pathname];
        const page = file.endsWith('.html');
        const served = page || file === 'layout.css' ? null : await uiFile(file, url.searchParams.get('v'));
        // The page loads its own script and stylesheet and talks to this server: nothing else, from anywhere, and it is not framed.
        // A file named by the UI's current version is kept for good (src/ui-files.ts); the pages, and the rest, never.
        res.writeHead(200, {
          'content-type': `${MIME[file.split('.').pop()!]}; charset=utf-8`,
          'cache-control': served?.keep ? 'public, max-age=31536000, immutable' : file === 'three.module.min.js' ? 'public, max-age=604800' : 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          ...(file === 'index.html' && { 'content-security-policy': PAGE_POLICY }),
          ...(file === 'draw.html' && { 'content-security-policy': options.unsandboxed ? DRAW_POLICY.replace('sandbox allow-scripts; ', '') : DRAW_POLICY }),
          // The frame has an origin of its own, so what it loads from here it loads as a stranger.
          ...((file === 'draw.js' || file === 'three.module.min.js') && { 'access-control-allow-origin': '*' }),
        });
        const html = page && (await uiPage(file));
        // Marked so the page makes its drawing frames with no sandbox (ui/base.js frameSandbox), as draw.html is served.
        if (html && options.unsandboxed) return res.end(html.replace('<html', '<html data-draw-sandbox="off"'));
        return res.end(file === 'layout.css' ? lengthsSheet((await workspaces.get(DEFAULT_WORKSPACE)).pelago.registry.packs) : html || served!.body);
      }

      if (req.method === 'GET' && url.pathname === '/whoami') {
        if (!local(req, false)) return send(res, 403, { error: 'Local requests only.' });
        const { ws, actor } = await resolve(req, res, 'human');
        return send(res, 200, { auth: tokens ? 'tokens' : 'off', dev: devMode(), workspace: { id: ws.id, name: ws.name }, actor: actor() });
      }

      // A pack's webhook: /hook/<pack>/<id> in the default workspace, /hook/<workspace>/<pack>/<id> in another.
      const hook = req.method === 'POST' && /^\/hook\/(?:([a-z0-9-]+)\/)?([a-z0-9_]+)\/([a-z0-9_.]+)$/.exec(url.pathname);
      if (hook && tooOften(req, res, deliveries)) return;
      if (hook) return (await workspaces.has(hook[1] ?? DEFAULT_WORKSPACE)) ? await serveHook(req, res, (await workspaces.get(hook[1] ?? DEFAULT_WORKSPACE)).pelago, hook[2], hook[3]) : send(res, 410, { error: 'No such workspace.' });

      if (url.pathname === '/mcp') {
        const { ws, pelago, actor } = await resolve(req, res, 'agent');
        return await serveMcp(req, res, { workspace: ws.id, pelago, actor }, hosts, req.method === 'POST' ? await readJson(req) : undefined);
      }

      const surface = url.pathname.startsWith('/api/') ? 'api' : url.pathname.startsWith('/agent/') ? 'agent' : undefined;
      if (req.method === 'POST' && surface) {
        if (!local(req)) return send(res, 403, { error: 'The API accepts only local JSON requests from the CLI, hooks or the pelago UI.' });
        const { pelago, actor, look } = await resolve(req, res, surface === 'api' ? 'human' : 'agent');
        const name = url.pathname.slice(surface.length + 2);
        if (look && !LOOK_READS.has(name)) return send(res, 403, { error: `A look reads; it does not call ${name}.` });
        try {
          const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
          if (surface === 'api') return send(res, 200, { result: await callTool(pelago, actor(), name, body) });
          // Scripts say which one they are in the body, as MCP callers do in their arguments.
          const { actor: label, ...input } = body;
          // An old name answers for one release, saying the call that replaces it (src/surface.ts).
          const moved_to = replacementOf(pelago.registry, name);
          return send(res, 200, { result: await callTool(pelago, actor((label as string) || 'script'), name, input), ...(moved_to && { moved_to }) });
        } catch (err) {
          if (err instanceof Refused) throw err;
          return send(res, 400, { error: (err as Error).message });
        }
      }

      if (req.method === 'POST' && url.pathname.startsWith('/hooks/')) {
        // Never from a web page, and only under a name this server answers to; with tokens on, the token says whose session it is.
        if (req.headers.origin || !hosts.includes(req.headers.host ?? '')) return send(res, 403, { error: 'Hooks are called by Claude Code, not from a web page, and at an address this server is known by.' });
        const { ws, pelago, actor } = await resolve(req, res, 'agent');
        const body = ((await readJson(req)) ?? {}) as { session_id?: string; cwd?: string; remote?: string; reason?: string; tokens?: number; setup?: string };
        const host = req.headers.host ?? '';
        const answer = await answerHook(url.pathname.slice('/hooks/'.length), { whole: ws.pelago.db, pelago, within: actor().within ?? [], may: actor().may, body, running, origin: `${named.includes(host) ? 'https' : 'http'}://${host}`, ran: (run) => res.setHeader('x-pelago-run', run) });
        if (answer) return send(res, 200, answer);
      }

      // The operator runs the installation: they create workspaces and hand
      // each one its first human token. They cannot read any workspace's map.
      // A workspace whose owner has lost their token gets a new one from the
      // operator. It does not revoke the old one: the owner does that once in.
      const reissue = tokens && req.method === 'POST' ? /^\/operator\/workspaces\/([^/]+)\/owner-token$/.exec(url.pathname) : null;
      if (reissue) {
        if (!local(req)) return send(res, 403, { error: 'Local requests only.' });
        if (!(await workspaces.isOperator(bearer(req.headers.authorization)))) return send(res, 401, { error: 'The operator secret is required.' });
        const id = decodeURIComponent(reissue[1]);
        if (!(await workspaces.has(id))) return send(res, 404, { error: `No workspace "${id}"` });
        return send(res, 200, { result: await ownerToken(await workspaces.get(id), 'owner (reissued)') });
      }
      if (tokens && req.method === 'POST' && url.pathname === '/operator/reset') {
        // Only from the server's own machine, by its local name, and never through a browser.
        const here = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && hosts.slice(0, 2).includes(req.headers.host ?? '');
        if (req.headers.origin || !here) return send(res, 403, { error: 'Only from the machine the server runs on.' });
        const secret = await workspaces.resetOperator(((await readJson(req)) as { proof?: string } | undefined)?.proof);
        if (!secret) return send(res, 401, { error: 'No reset was prepared, or the proof does not match.' });
        console.log('The operator secret was replaced from this machine.');
        return send(res, 200, { result: { operator_secret: secret, note: 'Keep this secret now: it is not stored and cannot be shown again. The old one no longer works.' } });
      }
      if (url.pathname === '/operator/workspaces' && tokens) {
        if (!local(req, req.method === 'POST')) return send(res, 403, { error: 'Local requests only.' });
        if (!(await workspaces.isOperator(bearer(req.headers.authorization)))) return send(res, 401, { error: 'The operator secret is required.' });
        if (req.method === 'GET') return send(res, 200, { result: await workspaces.list() });
        if (req.method === 'POST') {
          // `backup` is a backup file's bytes in base64: the workspace starts as that map.
          const { id, name, backup, vault } = ((await readJson(req)) ?? {}) as { id?: string; name?: string; backup?: string; vault?: string };
          try {
            // `vault`: the backup of the key vault taken with it, which a sealed backup is read with.
            const from = backup === undefined ? undefined : { ...parseBackup(Buffer.from(String(backup), 'base64')), ...(vault && { vault: parseVault(Buffer.from(vault, 'base64')) }) };
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
        if (err.retry) res.setHeader('retry-after', String(err.retry));
        return send(res, err.status, { error: err.message });
      }
      // What went wrong is the log's: the database's own words are not handed to whoever asked.
      console.error(`${req.method} ${req.url?.split('?')[0]}: ${(err as Error).stack ?? err}`);
      send(res, 500, { error: 'Something went wrong on the server. Try again; if it goes on, tell its operator.' });
    }
  });
}

if (import.meta.main) {
  const config = loadConfig();
  const rootDir = join(config.dataDir, '..', 'workspaces');
  // Before anything reads a secret: where the key they are sealed with is kept.
  configureSecrets(rootDir, !config.databaseUrl);
  const workspaces = new Workspaces({ dataDir: config.dataDir, databaseUrl: config.databaseUrl, rootDir, packsDir: config.packsDir, packs: config.packs, policy: config.policy, backupsDir: config.backup ? config.backup.dir : undefined });
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

  // Drawings with one wall, the worker: for a browser that loads no sandboxed frame. A dev server with no tokens only.
  const unsandboxed = config.dev && config.auth !== 'tokens' && env('UNSANDBOXED') === '1';
  if (unsandboxed) console.log('unsandboxed: drawing frames share the page’s origin (PELAGO_UNSANDBOXED=1)');
  const server = createHttpServer(workspaces, config.port, { auth: config.auth, publicHosts: config.publicHosts, sites: config.sites, proxies: config.trustedProxies, leading: () => leader?.leading ?? false, unsandboxed });
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
    stopDuties = serverDuties(leader, workspaces, serverPacksOf(workspaces), config.backup);
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
    await firstStart(workspaces, main, join(config.dataDir, '..')); // the two everything is made from, given once (src/first-start.ts)
  });
  let idle: ReturnType<typeof setInterval> | undefined;
  let leader: Leader | undefined;
  let stopDuties = () => {};
  const stop = async (code = 0) => {
    stopDuties();
    clearInterval(idle);
    await leader?.stop();
    stopAllLaunched();
    await drained(server, config.dev ? 1_000 : undefined); // the requests in hand answered before their databases close (src/drain.ts)
    await workspaces.closeAll();
    rmSync(lock, { force: true });
    process.exit(code);
  };
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
  // Leave time for the answer to the restart call to be sent, then hand over to src/dev.ts.
  if (config.dev) configureRestart(() => void setTimeout(() => stop(RESTART_EXIT), 200));
}
