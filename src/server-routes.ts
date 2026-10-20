// What a server pack offers anyone, with no login, all under /x/<pack>/: its pages (GET /x/<pack>/<page>, an HTML
// file from its public/ folder under a strict policy, and GET /x/<pack>/public/<file> for the script and stylesheet
// such a page loads), its public entries (POST /x/<pack>/<entry>, JSON in and out), and its webhooks
// (POST /x/<pack>/hook/<id>), each checked against a secret from the server's environment before the handler sees it.
// Every request is counted by address, as the other open routes are.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { serverPacksOf } from './server-host.ts';
import { serverSecret } from './server-packs.ts';
import type { ActPlaces } from './server-acts.ts';

/** A page's policy: its own script and stylesheet, talking to this server and to nothing else, never framed. */
const PAGE_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
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
    const page = !more && file.pages?.find((p) => p.id === name);
    if (page) return res.writeHead(200, { ...GUARD, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_POLICY }).end(await readFile(join(folder, 'public', page.file)));
    if (name === 'public' && ASSET.test(more)) {
      const bytes = await readFile(join(folder, 'public', more)).catch(() => null);
      if (bytes) return res.writeHead(200, { ...GUARD, 'content-type': TYPES[more.split('.').pop()!], 'content-security-policy': "default-src 'none'" }).end(bytes);
    }
    return json(404, { error: 'Not found' });
  }
  if (req.method !== 'POST') return json(405, { error: 'GET a page, POST an entry or a webhook.' });

  if (name === 'hook') {
    const hook = file.webhooks?.find((w) => w.id === more);
    if (!hook) return json(404, { error: 'Not found' });
    const raw = await at.raw();
    const secret = serverSecret(file.id, hook.secret);
    const signature = req.headers[(hook.header ?? 'x-signature-256').toLowerCase()];
    if (!secret || !signedBy(secret, raw, typeof signature === 'string' ? signature : undefined, hook.format)) return json(401, { error: 'The signature does not match.' });
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return json(400, { error: 'The body is not JSON.' });
    }
    try {
      return json(200, { result: await packs.call(file.id, 'webhook', hook.id, body) });
    } catch (err) {
      // A sender tries again on an error: a failure here is said as one, so it is.
      console.error(`server pack ${file.id} webhook ${hook.id}: ${(err as Error).message}`);
      return json(500, { error: (err as Error).message });
    }
  }
  const entry = !more && file.entries?.find((e) => e.id === name);
  if (!entry) return json(404, { error: 'Not found' });
  try {
    return json(200, { result: await packs.call(file.id, 'entry', entry.id, (await at.body()) ?? {}, entry.limit_ms) });
  } catch (err) {
    return json(400, { error: (err as Error).message });
  }
}
