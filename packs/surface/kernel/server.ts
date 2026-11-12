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
import { bearer, createToken, hashSecret, verifyToken, workspaceOf } from '../../../src/auth.ts'; import { firstStart } from './first-start.ts';
import { notify } from '../../../src/notify.ts'; import { alertOnCrash } from '../../../src/alert.ts';
import { parseBackup, parseVault } from '../../../src/backup.ts'; import { backupAll, backupDuty } from '../../../src/backup-run.ts'; import { adminEmails, admitMember, configureMembers, ownerEmail } from '../../../src/members.ts'; import { requestWait } from '../../../src/standing.ts'; import { dueForDeletion, standingGate } from './server-gates.ts'; import { askedAs, configureUse, slowTokensAt, storageBytes } from '../../../src/workspace-use.ts';
import { loadConfig, RESTART_EXIT, startedFrom } from '../../../src/config.ts'; import { env } from '../../../src/env.ts'; import type { Booted } from '../../../src/boot.ts';
import { SHORT, serveConnect } from './connect-routes.ts'; import { asked, installed, polled } from '../../../src/connect.ts'; import { challenge, mcpAddress } from '../../../src/oauth.ts'; import { itemAddress } from '../../../src/item-address.ts';
import { stopAllLaunched } from '../../../src/launcher.ts'; import { configureLaunch } from './server-launch.ts';
import { serveHook } from './hooks.ts'; import { serveMcp } from './mcp.ts';
import { setLookOrigin } from '../../../src/looks.ts'; import { LOOK_READS, passWorkspace, readPass } from '../../../src/look-pass.ts'; import { pageMay } from './may.ts';
import type { Actor, Archipelago } from '../../../src/pelago.ts';
import { configureOutbox } from '../../../src/outbox.ts'; import { configureIndex, tokenKnown, unindexToken } from '../../../src/control-index.ts'; import { isPersonToken, personAt } from '../../../src/person-tokens.ts';
import { serverPacksOf } from './server-host.ts'; import { configureConnections } from './root-connections.ts'; import { configureHookTool } from '../../../src/hook-tool.ts'; import { setReach } from '../../../src/pack-reach.ts';
import { pgLeader, soleLeader, whileLeads, type Leader } from '../../../src/leader.ts'; import { drained } from './drain.ts';
import { keepCounts } from '../../../src/pack-counts.ts';
import { clientAddress, trustedProxies } from '../../../src/address.ts';
import { DELIVERY_LIMIT, limiter, PUBLIC_LIMIT, REFUSED_LIMIT, SIGN_IN_LIMIT, type Limit } from './limit.ts';
import { servePublic } from '../../../src/public-route.ts'; import { siteNav } from '../../../src/site.ts'; import { ICON, serveIcon } from '../../../src/icon.ts';
import { previewOf } from '../../../src/published-preview.ts'; import { iconOf, lengthsSheet, pageLook, pageStyle } from '../../../src/styles.ts'; import { GUARD, json as send, PRIVATE, UNLISTED } from './reply.ts';
import { configureSecrets } from '../../../src/secrets.ts'; import { serveFilled } from './surface-slots.ts';
import { adapterBefore, answerAt, hookAt } from '../../../src/server-adapter.ts'; import { mountOf, serveMounted } from '../../../src/server-mounts.ts';
import { callTool, configureBackup, configureRestart, devMode, replacementOf } from './tools.ts';
import { UI_FILES, drawPage, uiFile, uiPage } from './ui-files.ts'; import { drawPolicy, markPage, PAGE_POLICY, PREVIEW_POLICY, SIGNED_IN_READER_POLICY } from '../../../src/page-policies.ts'; import { drawHostServes, drawHosts, type DrawHostOptions } from '../../../src/draw-host.ts'; import { serveDrawingFile } from './server-routes.ts';
import { DEFAULT_WORKSPACE, Workspaces, type Workspace } from '../../../src/workspaces.ts'; import { BOUNCED_DAYS, failedFor, fromRelay, hasBounced, noteBounced } from '../../../src/bounces.ts'; import { normalEmail, setBounced } from '../../../src/mail.ts';

/** What the open routes answer with that is above the surface (./connect-routes.ts): the mail pack's, the styles pack's and the connect pack's. */
const ABOVE = { email: normalEmail, pageStyle: (l: Archipelago) => pageStyle(l, {}, false), bounces: { fromRelay, failedFor, noteBounced, days: BOUNCED_DAYS }, connect: { installed, asked, polled } };

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

const bodies = new WeakMap<IncomingMessage, Promise<unknown>>(); // read once: a person token's call is routed by what its body names
const readJson = (req: IncomingMessage, most = BODY_MAX): Promise<unknown> => bodies.get(req) ?? (bodies.set(req, readBody(req, most).then((b) => { const text = b.toString('utf8'); try { return text ? JSON.parse(text) : undefined; } catch { throw new Refused(400, 'The body is not JSON.'); } })), bodies.get(req)!);

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

export function createHttpServer(workspaces: Workspaces, port: number, options: { auth?: 'off' | 'tokens'; publicHosts?: string[]; sites?: Record<string, string>; limits?: { open?: Limit; deliveries?: Limit; refused?: Limit; token?: Limit; signIn?: Limit }; proxies?: string; leading?: () => boolean; unsandboxed?: boolean; draw?: DrawHostOptions; roots?: Record<string, string> } = {}): Server {
  // The names this server answers to. A request for any other host is refused,
  // which is what stops another web page from reaching it through the browser.
  // The server's own Chrome may reach it by another name, from a container beside it (src/looks.ts).
  const lookAt = new URL(process.env.PELAGO_LOOK_ORIGIN ?? `http://127.0.0.1:${port}`);
  setLookOrigin(lookAt.origin);
  const [named, sites] = [options.publicHosts ?? [], options.sites ?? {}], hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...named, lookAt.host];
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...named.map((name) => `https://${name}`), lookAt.origin];
  const tokens = options.auth === 'tokens', drawing = drawHosts(port, origins, options.draw); // where the page frames its drawings (src/draw-host.ts)
  configureOutbox(async (id) => ((await workspaces.has(id)) ? (await workspaces.get(id)).pelago : undefined));
  // The address this server is reached at from outside: what a mailed link and the server packs (ctx.origin) name, never the look's.
  const serverPacks = serverPacksOf(workspaces);
  serverPacks.origin = named[0] ? `https://${named[0]}` : origins[0];
  configureConnections(serverPacks);
  setReach({ hold: (id) => workspaces.hold(id), connection: async (id, pack) => { const c = await serverPacks.connectionOf(pack, id); return c ? { id: c.id, account: c.account } : null; }, via: (id, pack, host, path) => serverPacks.lent(pack, host, id, path) });
  configureMembers({ origin: serverPacks.origin, nameOf: async (id) => (await workspaces.list()).find((w) => w.id === id)?.name ?? id, rename: (id, name) => workspaces.rename(id, name), standingOf: async (id) => (id === 'default' ? undefined : standingGate(serverPacks, await workspaces.control(), id)) }); configureIndex(() => workspaces.control()); configureUse(async (id) => storageBytes((await workspaces.get(id)).pelago.db)); workspaces.dueForDeletion = async (now) => dueForDeletion(serverPacks, await workspaces.control(), now); slowTokensAt(options.limits?.token); setBounced(async (email) => hasBounced((await workspaces.get(DEFAULT_WORKSPACE)).pelago, email)); // a bounced address is sent nothing (src/bounces.ts)

  // Which code this is and since when: after a push the old server goes on answering until the new one is up.
  const running = { commit: startedFrom(), started: new Date().toISOString(), roots: options.roots }; configureHookTool(serverPacks, running);

  // What answers without a token is counted by address: the public pages and the setup script, and GitHub's deliveries.
  const open = limiter(options.limits?.open ?? PUBLIC_LIMIT);
  const deliveries = limiter(options.limits?.deliveries ?? DELIVERY_LIMIT), signIn = limiter(options.limits?.signIn ?? SIGN_IN_LIMIT);
  // A token that is refused is counted too: finding one wrong can mean opening a workspace's database first.
  const refusedTokens = limiter(options.limits?.refused ?? REFUSED_LIMIT);
  /** Where a request came from: what the proxies we trust say, not what the caller wrote ahead of them (src/address.ts). */
  const trusted = trustedProxies(options.proxies);
  const addressOf = (req: IncomingMessage) => clientAddress(req.headers['x-forwarded-for'], req.socket.remoteAddress, trusted);
  /** True, and the request answered, when its address has asked too often. */
  const counted = new WeakMap<IncomingMessage, Set<unknown>>(); // a request counts once against a limit, though a pack passes it back (src/server-mounts.ts)
  const tooOften = (req: IncomingMessage, res: ServerResponse, count: ReturnType<typeof limiter>) => {
    if (counted.get(req)?.has(count)) return false; counted.set(req, (counted.get(req) ?? new Set()).add(count));
    const wait = count.take(addressOf(req)); if (wait) send(res, 429, { error: `Asked too often. Try again in ${wait} seconds.` }, { 'retry-after': String(wait) });
    return wait > 0; };

  /** The workspace a request is for and who is making it. */
  async function resolve(req: IncomingMessage, res: ServerResponse, surface: 'human' | 'agent', asks?: () => Promise<string | undefined>): Promise<{ ws: Workspace; pelago: Archipelago; actor: (label?: string) => Actor; look?: true }> {
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
      // An agent that gives no name acts under the one the surface before surfaces said (reach.server.adapter.before.agent).
      const ws = await workspaces.get(DEFAULT_WORKSPACE), unnamed = adapterBefore(serverPacks)?.before.agent ?? 'agent';
      return { ws, pelago: ws.pelago, actor: (label) => (surface === 'human' ? { kind: 'human', name: 'local', admin: true } : { kind: 'agent', name: label || unnamed }) };
    }
    const token = bearer(req.headers.authorization);
    const id = token && workspaceOf(token);
    // The same answer whether the token is malformed, unknown, expired or for a workspace that does not exist: nothing to probe.
    const address = addressOf(req);
    const wait = refusedTokens.full(address);
    if (wait) throw new Refused(429, `Too many requests from here were refused for their token. Try again in ${wait} seconds.`);
    const deny = () => {
      const toMcp = mcpAddress(req.url?.split('?')[0] ?? ''); // a client with no token yet starts here, from an address many hosted clients share
      if (token || !toMcp) refusedTokens.take(address); if (toMcp) res.setHeader('www-authenticate', challenge(req.headers.host ?? '', named, toMcp.workspace));
      return new Refused(401, 'A valid token is required. Send it as: Authorization: Bearer <token>');
    };
    // The workspace a call names: in its arguments, else its header, else its address; a person token's home, else.
    const header = req.headers['x-pelago-workspace'], asked = async () => (await asks?.()) || (typeof header === 'string' && header) || mcpAddress(req.url?.split('?')[0] ?? '')?.workspace;
    if (isPersonToken(token)) {
      const at = await personAt(token, asked, async (w) => ((await workspaces.has(w)) ? (await workspaces.get(w)).pelago.db : undefined));
      if (!at) throw deny(); // not a member there: the same answer as a token nobody made
      res.once('close', workspaces.hold(at.workspace)); const ws = await workspaces.get(at.workspace), as = at.actor;
      const slow = await requestWait(ws.id, token, askedAs(as)); if (slow.wait) throw new Refused(429, slow.refusal!, slow.wait);
      return { ws, pelago: ws.pelago.as(as.person ?? '', false, as.may === 'read'), actor: (label) => (label ? { ...as, name: `${as.name}/${label}` } : as) };
    }
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
    } else if (((await asked()) || id) !== id) throw deny(); // its own workspace alone, asked once it is known good
    const slow = await requestWait(ws.id, token, askedAs(identity.actor)); if (slow.wait) throw new Refused(429, slow.refusal!, slow.wait);
    if (identity.newPlace)
      await notify(ws.pelago, { kind: 'agent', name: 'pelago' }, {
        title: `The token "${identity.actor.name}" was used from a new place`,
        body: `It was used from ${identity.newPlace}, where it had not been used before. A machine that has moved networks does this. If it is not one of yours, revoke the token in Settings: whoever has it can act as that ${identity.actor.kind}.`,
        level: 'warning',
      }).catch((err) => console.error(`notify: ${(err as Error).message}`));
    // A token's identity is fixed; an agent may add a label to say which session it is.
    return {
      ws,
      // Everything this request reads or writes goes through the database as
      // this person sees it. A token tied to nobody sees only what is shared.
      pelago: ws.pelago.as(identity.actor.person ?? '', Boolean(identity.actor.admin), identity.actor.may === 'read'),
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
      const url = new URL(req.url ?? '/', 'http://localhost'), host = (req.headers.host ?? '').toLowerCase(), site = req.method === 'GET' ? sites[host] : undefined; const toItem = req.method === 'GET' && !site ? itemAddress(url.pathname) : undefined; if (toItem !== undefined) return toItem ? void res.writeHead(302, { location: toItem, 'cache-control': 'no-store' }).end() : send(res, 404, { error: 'Not found' }); // an item named outside the app (src/item-address.ts)
      if (drawing.only(host) && !(req.method === 'GET' && drawHostServes(url.pathname))) return send(res, 404, { error: 'Not found' }); // the drawing host serves drawings only
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, name: 'pelago', ...running, data: devMode() ? (workspaces.config.dataDir ?? undefined) : undefined, leading: options.leading?.() ?? true });
      // A domain that serves a workspace's public site: its pages by the reader pack (packs/reader), its icon; the rest as on any name.
      const mount = req.method === 'GET' ? mountOf(url.pathname, site) : undefined; // an address a server pack took from the kernel's list (src/server-mounts.ts)
      if (mount && (await serveMounted(req, res, mount, url.pathname, { packs: serverPacks, site, tokens, workspaces, named, sites, host, from: addressOf(req), tooOften: () => tooOften(req, res, open) }))) return;
      if (req.method === 'GET' && ICON.test(url.pathname)) return tooOften(req, res, open) || serveIcon(res, await iconOf((await workspaces.get(site ?? DEFAULT_WORKSPACE)).pelago));
      // The routes the packs above the surface fill (src/surface-slots.ts, surface.route): each counts its own requests.
      if (await serveFilled(req, res, url.pathname, { workspaces, tooOften: (limit) => tooOften(req, res, { open, deliveries, signIn }[limit]) })) return;
      // What a project needs to work with this server, and a running system's request for its token: no token needed.
      // A server pack answers at the addresses it had before it was a pack, too (a GitHub App set up then still sends there).
      const packPath = (req.method === 'GET' && Object.hasOwn(SHORT, url.pathname) ? SHORT[url.pathname] : serverPacks.aliased(url.pathname)) ?? url.pathname;
      if (/^\/(connect|x|oauth|\.well-known)\//.test(packPath)) return await serveConnect(req, res, packPath, { hosts, named, tokens, fallback: DEFAULT_WORKSPACE, workspaces, tooOften: () => tooOften(req, res, /^\/x\/[^/]+\/hook\//.test(packPath) ? deliveries : /^\/connect\/(sign-in|code|join|password|password\/set)$/.test(packPath) ? signIn : open), body: () => readJson(req, OPEN_BODY_MAX), raw: () => readBody(req, HOOK_BODY_MAX), person: () => resolve(req, res, 'human'), from: addressOf(req), ...ABOVE });

      // A product's public page, which the reader pack passed on: open to anyone, on any name this server has (src/public-route.ts).
      const pub = req.method === 'GET' ? /^\/p\/([^/]+)\/([^/]+)(?:\/(data|picture|drawing|live)(?:\/([^/]+))?)?\/?$/.exec(url.pathname) : null;
      if (pub) return tooOften(req, res, open) || (await servePublic(res, { workspace: pub[1], id: pub[2], what: pub[3], extra: pub[4], build: url.searchParams.get('build') ?? undefined }, { workspaces }));
      // A document read by someone signed in, to print or save as a PDF: the same page a link opens, which reads the
      // document with the reader's own token. The page holds nothing; what it shows is what that token may see.
      if (req.method === 'GET' && /^\/read\/e_[a-z0-9]{8}\/?$/.test(url.pathname)) {
        // Framed by this server's own page alone, to read a private document on the canvas (ui/reader-frame.js).
        res.writeHead(200, { ...PRIVATE, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': SIGNED_IN_READER_POLICY });
        return res.end(await uiPage('doc.html'));
      }
      // A document's preview, for someone signed in: the published page, drawn from what publishing would freeze now
      // (src/published-preview.ts), its site's other pages each led to by their own preview.
      if (req.method === 'GET' && /^\/preview\/e_[a-z0-9]{8}\/?$/.test(url.pathname)) {
        res.writeHead(200, { ...UNLISTED, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PREVIEW_POLICY });
        return res.end(markPage(await uiPage('doc.html'), { unsandboxed: options.unsandboxed }));
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

      if (req.method === 'GET' && url.pathname.startsWith('/drawing/')) return await serveDrawingFile(res, url.pathname, { tooOften: () => tooOften(req, res, open), reader: async () => ((ws) => (tokens ? ws.pelago.as('') : ws.pelago))(await workspaces.get(DEFAULT_WORKSPACE)) }); // a drawing's files by hash (src/drawing-files.ts), asked with no token: read as no one
      if (req.method === 'GET' && UI_FILES[url.pathname]) {
        const file = UI_FILES[url.pathname], framedBy = file === 'draw.html' ? drawing.framedBy(host, String(req.headers['sec-fetch-site'] ?? '')) : undefined;
        const page = file.endsWith('.html'), open = file === 'draw.html' && !framedBy && url.searchParams.get('open') === '1', frame = file === 'draw.html' ? await drawPage() : null;
        const served = page || file === 'layout.css' ? null : await uiFile(file, url.searchParams.get('v'));
        // The page loads its own script and stylesheet and talks to this server: nothing else, from anywhere, and it is not framed.
        // A file named by the UI's current version is kept for good (src/ui-files.ts); the pages, and the rest, never. The drawing frame has its scripts written in (drawPage).
        res.writeHead(200, {
          'content-type': `${MIME[file.split('.').pop()!]}; charset=utf-8`,
          'cache-control': served?.keep ? 'public, max-age=31536000, immutable' : file === 'three.module.min.js' ? 'public, max-age=604800' : 'no-store',
          ...GUARD,
          ...(file === 'index.html' && { 'content-security-policy': PAGE_POLICY }),
          ...(file === 'draw.html' ? { 'content-security-policy': drawPolicy(open, Boolean(options.unsandboxed), frame!.hashes, framedBy) } : {}),
          // The frame has an origin of its own, so what it loads from here it loads as a stranger.
          ...((file === 'draw.js' || file === 'draw-marks.js' || file === 'three.module.min.js') && { 'access-control-allow-origin': '*' }),
        });
        const html = page && (frame?.html ?? (await uiPage(file))), drawOrigin = file === 'index.html' && !options.unsandboxed && !(process.env.PELAGO_LOOK_ORIGIN && host === lookAt.host) ? drawing.originFor(host) : undefined; // a Chrome beside the server may not reach the drawing host: it draws sandboxed
        return res.end(html && (options.unsandboxed || open || drawOrigin) ? markPage(html, { open, unsandboxed: options.unsandboxed, drawOrigin }) : file === 'layout.css' ? lengthsSheet((await workspaces.get(DEFAULT_WORKSPACE)).pelago.registry.packs) : html || served!.body);
      }

      if (req.method === 'GET' && url.pathname === '/whoami') {
        if (!local(req, false)) return send(res, 403, { error: 'Local requests only.' });
        const { ws, actor, look } = await resolve(req, res, 'human'), me = actor(); // what it may do draws the page's controls (src/may.ts)
        return send(res, 200, { auth: tokens ? 'tokens' : 'off', dev: devMode(), workspace: { id: ws.id, name: ws.name }, actor: me, may: pageMay(me, Boolean(look), devMode() ? url.searchParams.get('may') : null) });
      }

      // A pack's webhook: /hook/<pack>/<id> in the default workspace, /hook/<workspace>/<pack>/<id> in another.
      const hook = req.method === 'POST' && /^\/hook\/(?:([a-z0-9-]+)\/)?([a-z0-9_]+)\/([a-z0-9_.]+)$/.exec(url.pathname);
      if (hook && tooOften(req, res, deliveries)) return;
      if (hook) return (await workspaces.has(hook[1] ?? DEFAULT_WORKSPACE)) ? await serveHook(req, res, (await workspaces.get(hook[1] ?? DEFAULT_WORKSPACE)).pelago, hook[2], hook[3]) : send(res, 410, { error: 'No such workspace.' });

      if (mcpAddress(url.pathname)) {
        const asks = async () => { const w = (req.method === 'POST' ? ((await readJson(req)) as { params?: { arguments?: { workspace?: unknown } } } | undefined) : undefined)?.params?.arguments?.workspace; return typeof w === 'string' ? w : undefined; };
        const { ws, pelago, actor } = await resolve(req, res, 'agent', asks);
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
        const host = req.headers.host ?? '', { surface, event } = hookAt(url.pathname.slice('/hooks/'.length)), answer = await answerAt(serverPacks, surface, event, { whole: ws.pelago.db, pelago, within: actor().within ?? [], may: actor().may, body, running, origin: `${named.includes(host) ? 'https' : 'http'}://${host}`, ran: (run) => res.setHeader('x-pelago-run', run) });
        if (answer) return send(res, 200, answer); else if (surface) return send(res, 410, { error: `No server pack here translates the hooks of "${surface}".` });
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
        // Each with its admins' addresses: one with none is a workspace nobody can sign in to by email.
        if (req.method === 'GET') return send(res, 200, { result: await Promise.all((await workspaces.list()).map(async (w) => ({ ...w, admins: await adminEmails((await workspaces.get(w.id)).pelago) }))) });
        if (req.method === 'POST') {
          // `backup` is a backup file's bytes in base64: the workspace starts as that map.
          const { id, name, backup, vault, email } = ((await readJson(req)) ?? {}) as { id?: string; name?: string; backup?: string; vault?: string; email?: string };
          try {
            // A new workspace is made with its owner's address; one from a backup brings its members with it.
            const admin = backup === undefined ? ownerEmail(email) : undefined;
            // `vault`: the backup of the key vault taken with it, which a sealed backup is read with.
            const from = backup === undefined ? undefined : { ...parseBackup(Buffer.from(String(backup), 'base64')), ...(vault && { vault: parseVault(Buffer.from(vault, 'base64')) }) };
            const ws = await workspaces.create(id ?? '', name ?? '', from);
            if (admin) await admitMember(ws.pelago, admin, true);
            const owner = await ownerToken(ws, 'owner');
            if (!from) return send(res, 200, { result: owner });
            const { rows } = await ws.pelago.db.query<{ entities: number; events: number }>(`select (select count(*)::int from entity) as entities, (select count(*)::int from log_op where stream = 'activity') as events`);
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

// Started through the boot stub (src/boot.ts), which checks and starts the root packs first; run directly, this goes through it too.
// `node src/server.ts` runs its shim, which is then the main module: this one answers for it.
if (import.meta.main || join(process.argv[1] ?? '.') === join(import.meta.dirname, '..', '..', '..', 'src', 'server.ts')) {
  try { serve(await (await import('../../../src/boot.ts')).boot()); } catch (err) { console.error((err as Error).message); process.exit(1); }
}

export function serve(booted: Booted): void {
  const config = loadConfig();
  const rootDir = join(config.dataDir, '..', 'workspaces');
  // Before anything reads a secret: where the key they are sealed with is kept.
  configureSecrets(rootDir, !config.databaseUrl);
  const workspaces = new Workspaces({ dataDir: config.dataDir, databaseUrl: config.databaseUrl, rootDir, packsDir: config.packsDir, packDirs: config.packDirs, packs: config.packs, workspacePacks: config.workspacePacks, policy: config.policy, backupsDir: config.backup ? config.backup.dir : undefined, defaultOnIslands: true, boot: booted });
  if (config.launch) configureLaunch({ mcpUrl: `http://127.0.0.1:${config.port}/mcp`, dir: join(config.dataDir, '..', 'runs'), auth: config.auth === 'tokens', packs: serverPacksOf(workspaces) });

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
  const server = createHttpServer(workspaces, config.port, { auth: config.auth, publicHosts: config.publicHosts, sites: config.sites, proxies: config.trustedProxies, leading: () => leader?.leading ?? false, unsandboxed, draw: { host: config.drawHost, loopback: config.dev }, roots: booted.hashes });
  // The port is taken before any database is opened: a second server started
  // by mistake must fail here, never open data another server is writing.
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is in use: another pelago server is probably running. Stop it first. No data was opened.` : err.message);
    process.exit(1);
  });
  server.listen(config.port, config.host, async () => {
    writeFileSync(lock, me);
    const main = await workspaces.get(DEFAULT_WORKSPACE);
    await booted.started(await workspaces.control(), startedFrom()).catch((err) => console.error(`recording the root packs: ${(err as Error).message}`)); // on the control log, each start
    console.log(`pelago listening on http://${config.host}:${config.port}  (MCP at /mcp)`);
    if (config.publicHosts.length) console.log(`answering to: ${config.publicHosts.join(', ')}${config.drawHost ? `, and drawings at ${config.drawHost}` : ''}`);
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
    stopDuties = whileLeads(leader, [() => backupDuty(workspaces, config.backup), () => serverPacksOf(workspaces).runSchedules()]); // the server's duties: backups (the backup pack) and the server packs' schedules
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
  const stopCounts = keepCounts((id) => workspaces.get(id)); // what packs counted (count.add), written down each minute and on the way down
  const stop = async (code = 0) => {
    stopDuties();
    clearInterval(idle);
    await leader?.stop();
    stopAllLaunched();
    await drained(server, config.dev ? 1_000 : undefined); // the requests in hand answered before their databases close (src/drain.ts)
    await stopCounts();
    await workspaces.closeAll();
    await booted.stop(); // the root packs, in reverse order
    rmSync(lock, { force: true });
    process.exit(code);
  };
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop()); alertOnCrash(hostname()); // a crash is mailed to the owner on the way down (src/alert.ts)
  // Leave time for the answer to the restart call to be sent, then hand over to scripts/dev.ts.
  if (config.dev) configureRestart(() => void setTimeout(() => stop(RESTART_EXIT), 200));
}
