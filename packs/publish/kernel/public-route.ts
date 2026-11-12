// What anyone may open at /p/<workspace>/<id> that the reader pack (packs/reader) does not answer: a product's
// public page (ui/public.html), its data and its results' pictures. A published document is the reader's; a product's
// page stays here while it reads software's proof and changelog views, which no act gives a pack (src/public.ts).
// Everything is read as the public role sees the map, so there is nothing here to guard: what is not public is not
// there to be found.

import type { ServerResponse } from 'node:http';
import { GUARD, POLICY } from '../../../src/public-document.ts';
import { publicPage, publicPicture } from '../../../src/public.ts';
import { pageLook } from '../../../src/styles.ts';
import { uiPage } from '../../../src/ui-files.ts';
import type { Workspaces } from '../../../src/workspaces.ts';

/** Answer a GET under /p/ for a product: its page, its data, or one of its results' pictures. */
export async function servePublic(res: ServerResponse, match: { workspace: string; id: string; what?: string; extra?: string; build?: string }, at: { workspaces: Workspaces }) {
  const { workspace, id, what, extra } = match;
  const none = () => res.writeHead(404, { ...GUARD, 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
  const pelago = (await at.workspaces.has(workspace)) ? (await at.workspaces.get(workspace)).pelago : null;
  if (!what) {
    // A product's page reads its data once open. What is not public, or not there, has no page at all.
    const found = pelago && (await pelago.forAnyone().db.query(`select 1 from entity where id = $1`, [id])).rows.length > 0;
    res.writeHead(found ? 200 : 404, { ...GUARD, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': POLICY });
    return res.end(await uiPage('public.html'));
  }
  if (!pelago) return none();
  if (what === 'data') {
    const page = await publicPage(pelago, id, match.build);
    if (!page) return none();
    return res.writeHead(200, { ...GUARD, 'content-type': 'application/json', 'cache-control': 'no-cache' }).end(JSON.stringify({ ...page, ...(await pageLook(pelago)) }));
  }
  if (what !== 'picture') return none();
  // Anything public in its own right shows its own picture.
  const picture = extra ? await publicPicture(pelago, extra) : null;
  if (!picture) return none();
  return res.writeHead(200, { ...GUARD, 'content-type': picture.content_type, 'cache-control': 'public, max-age=300', 'content-security-policy': "default-src 'none'" }).end(picture.bytes);
}
