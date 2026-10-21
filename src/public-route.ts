// What anyone may open at /p/<workspace>/<id>, with no login, on any name this server has: a public document, drawn
// as a link draws one (ui/doc.html) and left for search engines to index, or a product's public page (ui/public.html).
// Everything is read as the public role sees the map, so there is nothing here to guard: what is not public is not
// there to be found.

import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { publicDocument, publicDocumentPicture, publicHead } from './public-document.ts';
import { publicPage, publicPicture } from './public.ts';
import { pageLook } from './styles.ts';
import type { Workspaces } from './workspaces.ts';

const UI_DIR = join(import.meta.dirname, '..', 'ui');
const GUARD = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Where a public item's page is read: stable for as long as it is public, whatever it is renamed. */
export const publicPath = (workspace: string, id: string) => `/p/${workspace}/${id}`;

/** Answer a GET under /p/: its page, its data, or one of its pictures. */
export async function servePublic(res: ServerResponse, match: { workspace: string; id: string; what?: string; extra?: string; build?: string }, at: { workspaces: Workspaces; named: string[] }) {
  const { workspace, id, what, extra } = match;
  const none = () => res.writeHead(404, { ...GUARD, 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
  const pelago = (await at.workspaces.has(workspace)) ? (await at.workspaces.get(workspace)).pelago : null;
  const doc = pelago && (await publicDocument(pelago, id));
  if (!what) {
    // A public document's page carries its title, what it opens on and its address in the page itself, for a search engine.
    if (doc) {
      const path = publicPath(workspace, id);
      const page = publicHead(await readFile(join(UI_DIR, 'doc.html'), 'utf8'), doc, at.named[0] ? `https://${at.named[0]}${path}` : path);
      return res.writeHead(200, { ...GUARD, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': POLICY }).end(page);
    }
    // A product's page reads its data once open. What is not public, or not there, has no page at all.
    const found = pelago && (await pelago.forAnyone().db.query(`select 1 from entity where id = $1`, [id])).rows.length > 0;
    res.writeHead(found ? 200 : 404, { ...GUARD, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': POLICY });
    return res.end(await readFile(join(UI_DIR, 'public.html')));
  }
  if (!pelago) return none();
  if (what === 'data') {
    if (doc) return res.writeHead(200, { ...GUARD, 'content-type': 'application/json', 'cache-control': 'public, max-age=30' }).end(JSON.stringify({ ...doc, ...(await pageLook(pelago)) }));
    const page = await publicPage(pelago, id, match.build);
    if (!page) return none();
    return res.writeHead(200, { ...GUARD, 'content-type': 'application/json', 'cache-control': 'public, max-age=30' }).end(JSON.stringify({ ...page, ...(await pageLook(pelago)) }));
  }
  // A section of a public document shows its figure; anything public in its own right, its own.
  const picture = extra ? ((doc && (await publicDocumentPicture(pelago, id, extra))) ?? (await publicPicture(pelago, extra))) : null;
  if (!picture) return none();
  return res.writeHead(200, { ...GUARD, 'content-type': picture.content_type, 'cache-control': 'public, max-age=300', 'content-security-policy': "default-src 'none'" }).end(picture.bytes);
}
