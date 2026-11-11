// What a server pack offers anyone, with no login, all under /x/<pack>/: its pages (GET /x/<pack>/<page>, an HTML
// file from its public/ folder under a strict policy, and GET /x/<pack>/public/<file> for the script and stylesheet
// such a page loads), its public entries (POST /x/<pack>/<entry>, JSON in and out), and its webhooks
// (POST /x/<pack>/hook/<id>), each checked against a secret the kernel holds before the handler sees it. An entry marked
// GET is where a person comes back to from another site: it answers where to send them on; one that answers html makes
// a page per request, sent under the reader's policy with every header the kernel's. Every request is counted by
// address, as the other open routes are.
// A drawing's modules by hash (GET /drawing/<hash>/<module>.js, src/drawing-files.ts) are served here too.

import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { alertOwner } from './alert.ts';
import { drawingFile, drawingPath, drawingWorker, shippedDrawing } from './drawing-files.ts';
import type { Archipelago } from './pelago.ts';
import { signedWith } from './hashes.ts';
import { json as reply, PRIVATE as GUARD, GUARD as OPEN } from './reply.ts';
import { READER_POLICY } from './public-document.ts';
import { serverPacksOf } from './server-host.ts';
import { hostBase, serverSecret } from './server-requests.ts';
import { serveFile } from './server-files.ts';
import { serveStream } from './server-streams.ts';
import type { ActPlaces } from './server-acts.ts';

/** A page's policy: its own script and stylesheet, talking to this server and to nothing else, never framed; a form only to the site it names. */
const pagePolicy = (form = "'none'") => `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action ${form}; frame-ancestors 'none'`;
const TYPES: Record<string, string> = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp' };
const ASSET = /^[a-z0-9][a-z0-9_.-]{0,60}\.(js|css|svg|png|webp)$/;

export interface ServerRoutes {
  workspaces: ActPlaces;
  /** True, and the request answered, when its address has asked too often. */
  tooOften: () => boolean;
  body: () => Promise<unknown>;
  raw: () => Promise<Buffer>;
  /** Where the request comes from, for what is counted by address. */
  from?: string;
  /** Whether this server asks for a token. */
  tokens?: boolean;
}

const queryOf = (req: IncomingMessage) => Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams);

/** The statuses a made page may answer with: found, not found, gone. */
const PAGE_STATUSES = [200, 404, 410];
/** The most a made page may be, in bytes. */
export const PAGE_MOST = 2_000_000;
/** The longest a made page may be kept by a browser or a cache, in seconds. */
const CACHE_MOST = 86_400;

/** Tell the owner of the server, on the default map and by mail, that a webhook refused a delivery or failed on it (src/alert.ts). */
async function tellOwner(workspaces: ActPlaces, pack: string, hook: string, what: 'refused' | 'failed', detail: string): Promise<void> {
  const title = what === 'refused' ? `The ${pack} pack's webhook "${hook}" refused a delivery` : `The ${pack} pack's webhook "${hook}" failed`;
  await alertOwner((await workspaces.get('default')).pelago, { key: `hook/${pack}/${hook}/${what}`, title, body: detail, level: what === 'failed' ? 'urgent' : 'warning', from: `pack:${pack}` });
}

export async function serveServerPack(req: IncomingMessage, res: ServerResponse, path: string, at: ServerRoutes): Promise<unknown> {
  const json = (status: number, body: unknown) => reply(res, status, body, GUARD);
  const [, , id = '', name = '', more = '', extra, beyond] = path.split('/');
  const packs = serverPacksOf(at.workspaces);
  const pack = packs.find(id);
  // A stream is the one route with two parts after its name: the workspace and the document it listens to.
  const stream = req.method === 'GET' && extra !== undefined && beyond === undefined && pack?.file.reach.server.streams?.find((s) => s.id === name);
  if (!pack || (extra !== undefined && !stream)) return json(404, { error: 'Not found' });
  if (at.tooOften()) return;
  const { file, folder } = pack;
  if (stream) return serveStream(res, file, stream.id, { workspace: more, id: extra!, from: at.from, workspaces: at.workspaces });
  // A file it hands out, filled with this server's values (src/server-files.ts).
  if (req.method === 'GET' && name === 'files' && more) return serveFile(res, file, more, { origin: packs.origin, tokens: at.tokens ?? true, folder });

  if (req.method === 'GET') {
    const page = !more && file.reach.server.pages?.find((p) => p.id === name);
    if (page) {
      const host = page.form_action ? file.reach.hosts?.find((h) => h.id === page.form_action) : undefined;
      // The site it hands the person to may send them straight back here: a form's redirects are held to the policy too.
      return res.writeHead(200, { ...GUARD, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': pagePolicy(host && `'self' ${new URL(hostBase(file.id, host)).origin}`) }).end(await readFile(join(folder, 'public', page.file)));
    }
    const made = !more && file.reach.server.entries?.find((e) => e.id === name && e.method === 'GET' && e.answers === 'html');
    if (made) return madePage(res, () => packs.call(file.id, 'entry', made.id, queryOf(req), made.limit_ms));
    const back = !more && file.reach.server.entries?.find((e) => e.id === name && e.method === 'GET');
    if (back) return comeBack(res, () => packs.call(file.id, 'entry', back.id, queryOf(req), back.limit_ms));
    if (name === 'public' && ASSET.test(more)) {
      const bytes = await readFile(join(folder, 'public', more)).catch(() => null);
      if (bytes) return res.writeHead(200, { ...GUARD, 'content-type': TYPES[more.split('.').pop()!], 'content-security-policy': "default-src 'none'" }).end(bytes);
    }
    return json(404, { error: 'Not found' });
  }
  if (req.method !== 'POST') return json(405, { error: 'GET a page, POST an entry or a webhook.' });

  if (name === 'hook') {
    const hook = file.reach.webhooks?.find((w) => w.id === more);
    if (!hook) return json(404, { error: 'Not found' });
    const raw = await at.raw();
    const secret = await serverSecret(await packs.control(), file, hook.secret);
    const signature = req.headers[(hook.header ?? 'x-signature-256').toLowerCase()];
    if (!secret || !signedWith(secret, raw, typeof signature === 'string' ? signature : undefined, hook.format)) {
      // Most such are strangers; one from the sender itself means its secret and ours differ, and sales stop.
      console.error(`server pack ${file.id} webhook ${hook.id}: ${secret ? 'a delivery with a signature that does not match' : 'a delivery, and no secret is set'}`);
      await tellOwner(at.workspaces, file.id, hook.id, 'refused', secret ? 'Its signature did not match the secret this server holds. If the sender is the real one, the two secrets differ.' : `No secret is set for it on this server, so every delivery is refused.`);
      return json(401, { error: 'The signature does not match.' });
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return json(400, { error: 'The body is not JSON.' });
    }
    // What the delivery is, as its sender says in its headers: only those the webhook declares.
    if (hook.headers) body = { payload: body, headers: Object.fromEntries(hook.headers.map((h) => [h, req.headers[h.toLowerCase()]]).filter(([, v]) => typeof v === 'string')) };
    try {
      return json(200, { result: await packs.call(file.id, 'webhook', hook.id, body, hook.limit_ms) });
    } catch (err) {
      // A sender tries again on an error: a failure here is said as one, so it is.
      console.error(`server pack ${file.id} webhook ${hook.id}: ${(err as Error).message}`);
      await tellOwner(at.workspaces, file.id, hook.id, 'failed', `It failed on a signed delivery: ${(err as Error).message}. The sender will try again.`);
      return json(500, { error: (err as Error).message });
    }
  }
  const entry = !more && file.reach.server.entries?.find((e) => e.id === name && e.method !== 'GET');
  if (!entry) return json(404, { error: 'Not found' });
  try {
    // The input is the address's query and the body over it: JSON from a page, or a form, as a mail program's one-click
    // unsubscribe POSTs (RFC 8058: List-Unsubscribe=One-Click, its address naming what to stop).
    const query = Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams);
    const form = /^application\/x-www-form-urlencoded\b/i.test(req.headers['content-type'] ?? '');
    const body = form ? Object.fromEntries(new URLSearchParams((await at.raw()).toString('utf8'))) : ((await at.body()) ?? {});
    const input = body && typeof body === 'object' && !Array.isArray(body) ? { ...query, ...body } : body;
    return json(200, { result: await packs.call(file.id, 'entry', entry.id, input, entry.limit_ms) });
  } catch (err) {
    return json(400, { error: (err as Error).message });
  }
}

/** What GET /drawing/<hash>/<module>.js is handed: the map it reads, as the person asking sees it. */
export interface DrawingRoutes {
  /** True, and the request answered, when its address has asked too often. */
  tooOften: () => boolean;
  reader: () => Promise<Archipelago>;
}

/**
 * One module of a drawing, by its hash (src/drawing-files.ts): kept for good, since a hash is its content, and given
 * nothing to run with. Its service worker (sw.js, a pack's drawing's alone) is asked again each time, since it holds a
 * kernel file, and may import from this origin. What is not there is a 404 with nothing in it.
 */
export async function serveDrawingFile(res: ServerResponse, path: string, at: DrawingRoutes): Promise<unknown> {
  const asked = drawingPath(path);
  if (!asked) return res.writeHead(404, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end();
  const reader = await at.reader();
  // A pack's own drawing is served from what the packs ship, and a service worker installing it asks for every module at
  // once: only a read of the map (a drawing kept there, or a guess) is counted against the open limit.
  if (!shippedDrawing(reader, asked.hash) && at.tooOften()) return;
  const worker = asked.name === 'sw.js';
  const text = worker ? await drawingWorker(reader, asked.hash) : await drawingFile(reader, asked.hash, asked.name);
  if (text === null) return res.writeHead(404, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end();
  return res
    .writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': worker ? 'no-cache' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      // 'self' is the drawing host, which serves /three.js too (src/draw-host.ts): nothing of the page's origin is needed.
      'content-security-policy': worker ? "default-src 'none'; script-src 'self'" : "default-src 'none'",
    })
    .end(text);
}

/**
 * An address on this server, or its front page: a path, never //elsewhere. A browser drops tabs and line breaks from
 * an address, so /<tab>/elsewhere would be //elsewhere: none is let by.
 */
export const onThisServer = (to: string) => (/^\/(?![/\\])/.test(to) && !/[\u0000-\u001f\u007f]/.test(to) ? to : '/');

/** What went wrong, as a page with the way back: what a person sees when an entry fails them. */
function failed(res: ServerResponse, status: number, message: string): ServerResponse {
  const said = message.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  const page = `<!doctype html><meta charset="utf-8"><title>Archipelago</title><p>${said}</p><p><a href="/#/workspace">Back to Archipelago</a></p>`;
  return res.writeHead(status, { ...GUARD, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'" }).end(page);
}

/**
 * A page an entry makes for this request: { status?, html, cache? }, sent under the reader's policy with headers the
 * kernel sets alone. A status other than found, not found or gone, html that is no string or too long, and a cache
 * that is no whole number of seconds are refused: the person is shown that the page could not be made.
 */
async function madePage(res: ServerResponse, run: () => Promise<unknown>): Promise<unknown> {
  let answer: { status?: unknown; html?: unknown; cache?: unknown };
  try {
    answer = ((await run()) ?? {}) as typeof answer;
  } catch (err) {
    return failed(res, 500, (err as Error).message);
  }
  const status = answer.status ?? 200;
  const { html, cache } = answer;
  const why =
    typeof status !== 'number' || !PAGE_STATUSES.includes(status) ? `a page answers ${PAGE_STATUSES.join(', ')} or nothing, not ${String(status)}`
    : typeof html !== 'string' ? 'a page answers its html as a string'
    : Buffer.byteLength(html) > PAGE_MOST ? `a page is at most ${PAGE_MOST} bytes`
    : cache !== undefined && !(Number.isInteger(cache) && (cache as number) >= 0) ? 'a page is kept for a whole number of seconds'
    : '';
  if (why) {
    console.error(`server pack page: ${why}`);
    return failed(res, 500, 'This page could not be made.');
  }
  const kept = typeof cache === 'number' && cache > 0 ? `public, max-age=${Math.min(cache, CACHE_MOST)}` : 'no-store';
  return res.writeHead(status as number, { ...OPEN, 'cache-control': kept, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': READER_POLICY }).end(html);
}

/**
 * Send a person who came back from another site on to where the pack says: an address on this server only. What went
 * wrong is shown them as a page, with the way back.
 */
async function comeBack(res: ServerResponse, run: () => Promise<unknown>): Promise<unknown> {
  try {
    const to = String((((await run()) ?? {}) as { redirect?: unknown }).redirect ?? '/');
    return res.writeHead(302, { ...GUARD, location: onThisServer(to) }).end();
  } catch (err) {
    return failed(res, 400, (err as Error).message);
  }
}
