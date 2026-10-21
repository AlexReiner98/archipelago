// What anyone may open at /p/<workspace>/<id>, with no login, on any name this server has: a public document as it
// was last published (src/published.ts), drawn as a link draws one (ui/doc.html) and left for search engines to index, or a product's public page (ui/public.html).
// Everything is read as the public role sees the map, so there is nothing here to guard: what is not public is not
// there to be found.

import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Part } from './documents.ts';
import { GUARD, POLICY, publicHead } from './public-document.ts';
import { publishedDocument, publishedPicture } from './published.ts';
import { publicPage, publicPicture } from './public.ts';
import { siteHref, siteNav } from './site.ts';
import { pageLook } from './styles.ts';
import type { Workspaces } from './workspaces.ts';

const UI_DIR = join(import.meta.dirname, '..', 'ui');

/** Where a public item's page is read: stable for as long as it is public, whatever it is renamed. */
export const publicPath = (workspace: string, id: string) => `/p/${workspace}/${id}`;

/** Answer a GET under /p/: its page, its data, or one of its pictures. */
export async function servePublic(res: ServerResponse, match: { workspace: string; id: string; what?: string; extra?: string; build?: string }, at: { workspaces: Workspaces; named: string[]; sites?: Record<string, string> }) {
  const { workspace, id, what, extra } = match;
  const none = () => res.writeHead(404, { ...GUARD, 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
  const pelago = (await at.workspaces.has(workspace)) ? (await at.workspaces.get(workspace)).pelago : null;
  // A document is read as it was last published, never as the map has it now.
  const doc = pelago && ((await publishedDocument(pelago, id)) as { title: string; parts: Part[]; path?: string | null } | null);
  // A workspace with a domain of its own: its pages' addresses there are the ones to keep.
  const domain = Object.entries(at.sites ?? {}).find(([, ws]) => ws === workspace)?.[0];
  const site = doc && pelago ? await siteNav(at.workspaces, workspace, (page) => publicPath(workspace, page.id)) : null;
  if (!what) {
    // A public document's page carries its title, what it opens on and its address in the page itself, for a search engine.
    if (doc) {
      const path = publicPath(workspace, id);
      const canonical = domain && doc.path ? `https://${domain}${siteHref(doc.path)}` : at.named[0] ? `https://${at.named[0]}${path}` : path;
      const page = publicHead(await readFile(join(UI_DIR, 'doc.html'), 'utf8'), doc, canonical, site?.name);
      return res.writeHead(200, { ...GUARD, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': POLICY }).end(page);
    }
    // A product's page reads its data once open. What is not public, or not there, has no page at all.
    const found = pelago && (await pelago.forAnyone().db.query(`select 1 from entity where id = $1`, [id])).rows.length > 0;
    res.writeHead(found ? 200 : 404, { ...GUARD, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': POLICY });
    return res.end(await readFile(join(UI_DIR, 'public.html')));
  }
  if (!pelago) return none();
  if (what === 'data') {
    if (doc) return res.writeHead(200, { ...GUARD, 'content-type': 'application/json', 'cache-control': 'public, max-age=30' }).end(JSON.stringify({ ...doc, ...(await pageLook(pelago)), site }));
    const page = await publicPage(pelago, id, match.build);
    if (!page) return none();
    return res.writeHead(200, { ...GUARD, 'content-type': 'application/json', 'cache-control': 'public, max-age=30' }).end(JSON.stringify({ ...page, ...(await pageLook(pelago)) }));
  }
  // A section of a public document shows its figure; anything public in its own right, its own.
  const picture = extra ? ((doc && (await publishedPicture(pelago, id, extra))) ?? (await publicPicture(pelago, extra))) : null;
  if (!picture) return none();
  return res.writeHead(200, { ...GUARD, 'content-type': picture.content_type, 'cache-control': 'public, max-age=300', 'content-security-policy': "default-src 'none'" }).end(picture.bytes);
}
