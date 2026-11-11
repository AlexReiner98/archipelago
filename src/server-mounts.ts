// The addresses a server pack takes from the kernel's closed list (task e_p2e8d9er, decision e_wptrr6tf): public
// (GET /p/<workspace>/<id>[/<what>[/<extra>]]), site (any GET on a domain PELAGO_SITES names) and setup
// (/connect/setup.mjs). Each is taken by at most one pack (src/server-packs.ts refuses a second); the kernel parses
// the address and hands the parts to the pack's entry or file. With no pack mounted, the kernel answers as before.
//
// What a mounted entry answers is one of a closed list, each sent with headers the kernel sets alone (src/reply.ts):
// a page ({ html }: the UI's files it names versioned as the kernel's own pages name them, and framed by this server's
// own page on /p/ alone), JSON ({ json }), a picture ({ picture: { content_type, base64 } }, under a policy that runs nothing), text of a type from a short list
// ({ text, type }), a redirect on this server ({ redirect }), the kernel's own stream of a published document
// ({ stream: true, id? }), or nothing ({ pass: true }): the kernel answers the address as it would with no pack there.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ICON } from './icon.ts';
import { GUARD, POLICY, READER_POLICY } from './public-document.ts';
import { publicView } from './public-view-store.ts';
import { listenForPack } from './published-live.ts';
import { json } from './reply.ts';
import type { ActPlaces } from './server-acts.ts';
import { serveFile } from './server-files.ts';
import type { ServerPacks } from './server-host.ts';
import type { Mount } from './server-reach.ts';
import { onThisServer } from './server-routes.ts';
import { UI_FILES, uiVersioned } from './ui-files.ts';

export interface MountCall {
  packs: ServerPacks;
  /** The domain's workspace, for a site. */
  site?: string;
  /** True, and the request answered, when its address has asked too often. */
  tooOften: () => boolean;
  /** Whether this server asks for a token, as a setup file is filled with ({tokens}). */
  tokens?: boolean;
  /** The server's workspaces: a stream is held only for a document published on one, read as anyone reads it. */
  workspaces?: Pick<ActPlaces, 'has' | 'get'> & { list?: () => Promise<{ id: string; name: string }[]> };
  /** The names this server has, its first the one to keep, and the domains that serve a workspace's site. */
  named?: string[];
  sites?: Record<string, string>;
  /** The domain asked for, on a site. */
  host?: string;
  /** Where the request comes from, for the limit on how many listen from one address. */
  from?: string;
}

/** A public address in its parts: /p/<workspace>/<id>[/<what>[/<extra>]]. */
const PUBLIC = /^\/p\/([^/]+)\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/;
/** The longest anything a mounted entry answers may be kept, in seconds: a year, and then it never changes. */
const YEAR = 31_536_000;
/** The text a mounted entry may answer, by the type it names. */
const TEXTS: Record<string, string> = { 'text/plain': 'text/plain; charset=utf-8', 'application/xml': 'application/xml; charset=utf-8', 'text/css': 'text/css; charset=utf-8', 'text/javascript': 'text/javascript; charset=utf-8' };
const PICTURE = /^image\/(png|jpeg|gif|webp|svg\+xml)$/;

/** Which mount an address is, if any: the site of a domain the server names first, then /p/, then the setup. */
export function mountOf(pathname: string, site: string | undefined): Mount | undefined {
  // A site's domain serves the kernel's own files (its pages' scripts and styles, its icon) as every name does.
  if (site) return (UI_FILES[pathname] !== undefined && pathname !== '/') || ICON.test(pathname) ? undefined : 'site';
  if (/^\/p\//.test(pathname)) return 'public';
  if (pathname === '/connect/setup.mjs') return 'setup';
  return undefined;
}

/** The pack that took a mount, and what it names there. */
function mountedAt(packs: ServerPacks, mount: Mount): { id: string; to: string } | undefined {
  for (const { file } of packs.packs) {
    const to = file.reach.server.mounts?.[mount];
    if (to) return { id: file.id, to };
  }
  return undefined;
}

/** What a mounted entry hands the kernel for its address, or undefined when the address is not one it answers. */
function partsOf(mount: Mount, pathname: string, site: string | undefined): Record<string, string> | undefined {
  if (mount === 'site') return site ? { workspace: site, path: pathname } : undefined;
  const m = PUBLIC.exec(pathname);
  if (!m) return undefined;
  return { workspace: m[1], id: m[2], ...(m[3] && { what: m[3] }), ...(m[4] && { extra: m[4] }) };
}

/** What the server says of where the address is, beside its parts: the workspace's name, the name to keep, its domain. */
async function placeOf(mount: Mount, parts: Record<string, string>, at: MountCall): Promise<Record<string, string>> {
  const name = (await at.workspaces?.list?.().catch(() => []))?.find((ws) => ws.id === parts.workspace)?.name;
  // A site is told the app's own address too, where its /install leads (it is this server under its first name), and
  // the page a person with no account begins at there (start), where its main button leads.
  if (mount === 'site') return { ...(name && { name }), ...(at.host && { host: at.host }), ...(at.packs.origin && { app: at.packs.origin }), ...(at.packs.start() && { start: at.packs.start()! }) };
  const domain = Object.entries(at.sites ?? {}).find(([, ws]) => ws === parts.workspace)?.[0];
  return { ...(name && { name }), ...(at.named?.[0] && { named: at.named[0] }), ...(domain && { domain }) };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
/**
 * What the request said that a page may answer by, handed to a public or site entry and kept by the kernel nowhere: its
 * query, the name it was sent to (host), the page before (referrer), the browser's name for itself (agent), and whether
 * it was fetched ahead (purpose), and what it asks to be answered in (accept).
 */
export function requestOf(req: Pick<IncomingMessage, 'url' | 'headers'>) {
  const at = (req.url ?? '').indexOf('?');
  const h = req.headers;
  return { query: at < 0 ? '' : (req.url ?? '').slice(at + 1), host: one(h.host).toLowerCase(), referrer: one(h.referer), agent: one(h['user-agent']), purpose: one(h['sec-purpose']) || one(h.purpose), accept: one(h.accept) };
}

/** How long what was answered may be kept: whole seconds said, up to a year (then for good), else as otherwise. */
const keptFor = (cache: unknown, otherwise: string) =>
  Number.isInteger(cache) && (cache as number) > 0 ? `public, max-age=${Math.min(cache as number, YEAR)}${(cache as number) >= YEAR ? ', immutable' : ''}` : otherwise;

type Answer = { status?: unknown; html?: unknown; json?: unknown; picture?: unknown; text?: unknown; type?: unknown; redirect?: unknown; stream?: unknown; id?: unknown; pass?: unknown; cache?: unknown };
type Sent = { pack?: string; workspace?: string; id?: string; site?: boolean; app?: string } & Pick<MountCall, 'workspaces' | 'from'>;

/** Send what a mounted entry answered, by its kind; anything else is the pack's fault. False when it passed. */
export async function sendPage(res: ServerResponse, answer: unknown, at: Sent = {}): Promise<boolean> {
  const a = (answer ?? {}) as Answer;
  const status = Number.isInteger(a.status) && (a.status as number) >= 200 && (a.status as number) <= 599 ? (a.status as number) : 200;
  const fault = (why: string) => (json(res, 502, { error: `The pack answered ${why}.` }, GUARD), true);
  if (a.pass === true) return false;
  if (typeof a.html === 'string') {
    res.writeHead(status, { ...GUARD, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': at.site ? POLICY : READER_POLICY }).end(await uiVersioned(a.html));
    return true;
  }
  if (a.json !== undefined) return (json(res, status, a.json, { ...GUARD, 'cache-control': keptFor(a.cache, 'no-cache') }), true);
  if (a.picture !== undefined) {
    const p = (a.picture ?? {}) as { content_type?: unknown; base64?: unknown };
    if (typeof p.content_type !== 'string' || !PICTURE.test(p.content_type) || typeof p.base64 !== 'string') return fault('a picture that is not one');
    res.writeHead(status, { ...GUARD, 'content-type': p.content_type, 'cache-control': keptFor(a.cache, 'no-cache'), 'content-security-policy': "default-src 'none'" }).end(Buffer.from(p.base64, 'base64'));
    return true;
  }
  if (typeof a.text === 'string') {
    const type = TEXTS[String(a.type)];
    if (!type) return fault(`text of a type not one of ${Object.keys(TEXTS).join(', ')}`);
    res.writeHead(status, { ...GUARD, 'content-type': type, ...(a.cache !== undefined && { 'cache-control': keptFor(a.cache, 'no-cache') }) }).end(a.text);
    return true;
  }
  if (typeof a.redirect === 'string') {
    res.writeHead(status === 301 ? 301 : 302, { ...GUARD, location: at.app && a.redirect.startsWith(`${at.app}/`) && !/[\u0000-\u001f\u007f]/.test(a.redirect) ? a.redirect : onThisServer(a.redirect), 'content-type': 'text/plain; charset=utf-8' }).end('Moved');
    return true;
  }
  if (a.stream === true) {
    // The kernel's own stream of a document published on this workspace, read as anyone reads it: nothing the pack holds.
    const id = typeof a.id === 'string' ? a.id : at.id;
    const ws = at.workspace;
    const found = Boolean(id && ws && at.pack && at.workspaces && (await at.workspaces.has(ws).catch(() => false)) && (await publicView((await at.workspaces.get(ws)).pelago, id)));
    if (!found) return (json(res, 404, { error: 'Not found' }, GUARD), true);
    listenForPack(res, at.pack!, ws!, id!, GUARD, at.from);
    return true;
  }
  return fault('nothing it may answer');
}

/** Answer an address at a mount a pack took; false when no pack took it, or it passed, and the kernel answers as before. */
export async function serveMounted(req: IncomingMessage, res: ServerResponse, mount: Mount, pathname: string, at: MountCall): Promise<boolean> {
  const taken = mountedAt(at.packs, mount);
  if (!taken) return false;
  if (mount === 'setup') {
    if (at.tooOften()) return true;
    await serveFile(res, at.packs.find(taken.id)!.file, taken.to, { origin: at.packs.origin, tokens: at.tokens ?? false });
    return true;
  }
  const parts = partsOf(mount, pathname, at.site);
  if (!parts) return false;
  if (at.tooOften()) return true;
  let answer: unknown;
  try {
    answer = await at.packs.call(taken.id, 'entry', taken.to, { ...parts, ...(await placeOf(mount, parts, at)), request: requestOf(req) });
  } catch (err) {
    console.error(`server pack ${taken.id} at ${mount}: ${(err as Error).message}`);
    json(res, 502, { error: 'The pack that answers here did not.' }, GUARD);
    return true;
  }
  return sendPage(res, answer, { pack: taken.id, workspace: parts.workspace, id: parts.id, site: mount === 'site', app: at.packs.origin, workspaces: at.workspaces, from: at.from });
}
