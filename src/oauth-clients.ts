// Who is asking to connect: an MCP client, as OAuth names one (src/oauth.ts). A client that registers (RFC 7591) is told
// a client_id that holds what it said, so registering keeps nothing and anyone may do it; one that publishes a document
// (Client ID Metadata) gives the address of that document as its client_id, read through src/outbound.ts. Neither proves
// who the client is, which is why a person is shown where it returns to and says yes each time.

import { guardedFetch } from './outbound.ts';

export interface Client {
  id: string;
  name: string;
  redirects: string[];
}

const NAME_MOST = 60;
const REDIRECTS_MOST = 8;
/** The most a registered client's id holds, and the most of a published document that is read. */
const ID_MOST = 2000;
const DOCUMENT_MOST = 8192;
const KEEP_MS = 600_000;
const KEPT_MOST = 200;
const FETCH_MS = 5000;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** What a browser would run or read rather than hand to an application. */
const NEVER = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'about:', 'blob:', 'filesystem:', 'ftp:', 'view-source:', 'ws:', 'wss:']);

const parsed = (uri: unknown) => {
  try {
    return typeof uri === 'string' ? new URL(uri) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A place a client may be sent back to: https, this machine by http, or an application's own scheme. MCP's specification
 * names only the first two, but a desktop editor such as Cursor returns by its own scheme (RFC 8252), and PKCE is what
 * protects that code; the page shows such a client as an application, not as a site.
 */
export function goodRedirect(uri: unknown): boolean {
  const u = parsed(uri);
  if (!u || u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname);
  return !NEVER.has(u.protocol);
}

/** Whether a redirect is one a client listed: exactly, but for the port on this machine, which a native client picks as it runs (RFC 8252). */
export function listedRedirect(client: Client, uri: string): boolean {
  if (client.redirects.includes(uri)) return true;
  const u = parsed(uri);
  if (!u || u.protocol !== 'http:' || !LOOPBACK.has(u.hostname)) return false;
  const bare = (x: URL) => `${x.hostname}${x.pathname}${x.search}`;
  return client.redirects.some((r) => {
    const listed = parsed(r);
    return listed?.protocol === 'http:' && bare(listed) === bare(u);
  });
}

/** Where a person is told they return to, in words. */
export function returnsTo(uri: string): string {
  const u = new URL(uri);
  if (u.protocol === 'https:') return u.hostname;
  return u.protocol === 'http:' ? 'this computer' : `the ${u.protocol.slice(0, -1)} app`;
}

const cleanName = (name: unknown, fallback: string) => (typeof name === 'string' ? name.replace(/\p{C}/gu, '').trim().slice(0, NAME_MOST) : '') || fallback;
const clientRedirects = (uris: unknown): string[] | undefined => {
  if (!Array.isArray(uris) || !uris.length || uris.length > REDIRECTS_MOST || !uris.every(goodRedirect)) return undefined;
  return uris as string[];
};

/** A client registering itself: what it is told. Nothing is kept. */
export function registerClient(input: unknown) {
  const body = (input ?? {}) as { client_name?: unknown; redirect_uris?: unknown; client_uri?: unknown };
  const redirects = clientRedirects(body.redirect_uris);
  if (!redirects) throw new Error('redirect_uris must list https addresses, addresses on this machine, or an application’s own scheme.');
  const name = cleanName(body.client_name, 'An MCP client');
  const id = `cl_${Buffer.from(JSON.stringify({ n: name, r: redirects })).toString('base64url')}`;
  if (id.length > ID_MOST) throw new Error('That client says too much to register.');
  return { client_id: id, client_name: name, redirect_uris: redirects, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', client_id_issued_at: Math.floor(Date.now() / 1000) };
}

function fromId(id: string): Client | undefined {
  if (id.length > ID_MOST) return undefined;
  try {
    const { n, r } = JSON.parse(Buffer.from(id.slice(3), 'base64url').toString()) as { n: unknown; r: unknown };
    const redirects = clientRedirects(r);
    return redirects && { id, name: cleanName(n, 'An MCP client'), redirects };
  } catch {
    return undefined;
  }
}

const published = new Map<string, { client: Client; until: number }>();

/** Read a client's published document: its client_id must be its own address, and every redirect a good one. */
async function fromDocument(id: string, get: typeof fetch): Promise<Client | undefined> {
  const url = parsed(id);
  if (url?.protocol !== 'https:' || url.pathname === '/' || url.hash) return undefined;
  const held = published.get(id);
  if (held && held.until > Date.now()) return held.client;
  try {
    const res = await get(id, { signal: AbortSignal.timeout(FETCH_MS), headers: { accept: 'application/json' } });
    const text = res.ok ? await res.text() : '';
    if (!text || text.length > DOCUMENT_MOST) return undefined;
    const doc = JSON.parse(text) as { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown };
    const redirects = clientRedirects(doc.redirect_uris);
    if (doc.client_id !== id || !redirects) return undefined;
    const client = { id, name: cleanName(doc.client_name, url.hostname), redirects };
    if (published.size >= KEPT_MOST) published.clear();
    published.set(id, { client, until: Date.now() + KEEP_MS });
    return client;
  } catch {
    return undefined;
  }
}

/** The client a client_id names, or nothing. */
export async function clientOf(id: unknown, get: typeof fetch = guardedFetch): Promise<Client | undefined> {
  if (typeof id !== 'string') return undefined;
  return id.startsWith('cl_') ? fromId(id) : fromDocument(id, get);
}
