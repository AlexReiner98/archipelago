// What a server pack offers anyone, with no login, all under /x/<pack>/: its pages (GET /x/<pack>/<page>, an HTML
// file from its public/ folder under a strict policy, and GET /x/<pack>/public/<file> for the script and stylesheet
// such a page loads), its public entries (POST /x/<pack>/<entry>, JSON in and out), and its webhooks
// (POST /x/<pack>/hook/<id>), each checked against a secret the kernel holds before the handler sees it. An entry marked
// GET is where a person comes back to from another site: it answers where to send them on. Every request is counted
// by address, as the other open routes are.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { notify } from './notify.ts';
import { serverPacksOf } from './server-host.ts';
import { hostBase, serverSecret } from './server-requests.ts';
import type { ActPlaces } from './server-acts.ts';

/** A page's policy: its own script and stylesheet, talking to this server and to nothing else, never framed; a form only to the site it names. */
const pagePolicy = (form = "'none'") => `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action ${form}; frame-ancestors 'none'`;
const TYPES: Record<string, string> = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp' };
const ASSET = /^[a-z0-9][a-z0-9_.-]{0,60}\.(js|css|svg|png|webp)$/;
const GUARD = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };

export interface ServerRoutes {
  workspaces: ActPlaces;
  /** True, and the request answered, when its address has asked too often. */
  tooOften: () => boolean;
  body: () => Promise<unknown>;
  raw: () => Promise<Buffer>;
}

/** How often the owner is told that one pack's webhook refused a delivery or failed on one: once an hour at most. */
const TOLD_EVERY_MS = 3_600_000;
const told = new Map<string, number>();
/** Tell the owner of the server, on the default map, that a webhook refused a delivery or failed on it. */
async function tellOwner(workspaces: ActPlaces, pack: string, hook: string, what: 'refused' | 'failed', detail: string): Promise<void> {
  const key = `${pack}/${hook}/${what}`;
  if (Date.now() - (told.get(key) ?? 0) < TOLD_EVERY_MS) return;
  told.set(key, Date.now());
  const owner = (await workspaces.get('default')).pelago;
  const title = what === 'refused' ? `The ${pack} pack's webhook "${hook}" refused a delivery` : `The ${pack} pack's webhook "${hook}" failed`;
  await notify(owner, { kind: 'agent', name: `pack:${pack}` }, { title, body: `${detail}

Said once an hour at most; the server's log has each one.`, level: what === 'failed' ? 'urgent' : 'warning' }).catch((err) => console.error(`telling the owner: ${(err as Error).message}`));
}

/** Whether a body was signed with the secret: sha256=<hex> (prefixed, as GitHub sends) or the bare hex. */
export function signedBy(secret: string, raw: Buffer, signature: string | undefined, format: 'prefixed' | 'hex' = 'prefixed'): boolean {
  const hex = createHmac('sha256', secret).update(raw).digest('hex');
  const want = Buffer.from(format === 'hex' ? hex : `sha256=${hex}`);
  const got = Buffer.from((signature ?? '').trim());
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function serveServerPack(req: IncomingMessage, res: ServerResponse, path: string, at: ServerRoutes): Promise<unknown> {
  const json = (status: number, body: unknown) => res.writeHead(status, { ...GUARD, 'content-type': 'application/json' }).end(JSON.stringify(body));
  const [, , id = '', name = '', more = '', extra] = path.split('/');
  const packs = serverPacksOf(at.workspaces);
  const pack = packs.find(id);
  if (!pack || extra !== undefined) return json(404, { error: 'Not found' });
  if (at.tooOften()) return;
  const { file, folder } = pack;

  if (req.method === 'GET') {
    const page = !more && file.reach.server.pages?.find((p) => p.id === name);
    if (page) {
      const host = page.form_action ? file.reach.hosts?.find((h) => h.id === page.form_action) : undefined;
      // The site it hands the person to may send them straight back here: a form's redirects are held to the policy too.
      return res.writeHead(200, { ...GUARD, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': pagePolicy(host && `'self' ${new URL(hostBase(file.id, host)).origin}`) }).end(await readFile(join(folder, 'public', page.file)));
    }
    const back = !more && file.reach.server.entries?.find((e) => e.id === name && e.method === 'GET');
    if (back) return comeBack(res, () => packs.call(file.id, 'entry', back.id, Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams), back.limit_ms));
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
    if (!secret || !signedBy(secret, raw, typeof signature === 'string' ? signature : undefined, hook.format)) {
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
    return json(200, { result: await packs.call(file.id, 'entry', entry.id, (await at.body()) ?? {}, entry.limit_ms) });
  } catch (err) {
    return json(400, { error: (err as Error).message });
  }
}

/**
 * Send a person who came back from another site on to where the pack says: an address on this server only. What went
 * wrong is shown them as a page, with the way back.
 */
async function comeBack(res: ServerResponse, run: () => Promise<unknown>): Promise<unknown> {
  try {
    const to = String((((await run()) ?? {}) as { redirect?: unknown }).redirect ?? '/');
    return res.writeHead(302, { ...GUARD, location: /^\/(?![/\\])/.test(to) ? to : '/' }).end();
  } catch (err) {
    const said = (err as Error).message.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    const page = `<!doctype html><meta charset="utf-8"><title>Archipelago</title><p>${said}</p><p><a href="/#/workspace">Back to Archipelago</a></p>`;
    return res.writeHead(400, { ...GUARD, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'" }).end(page);
  }
}
