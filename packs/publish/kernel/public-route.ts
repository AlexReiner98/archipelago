// What anyone may open at /p/<workspace>/<id> that the reader pack (packs/reader) does not answer: a product's
// public page (ui/public.html, drawn by packs/surface/page/frozen-page.js), its data and its results' pictures. A published document is the reader's; a product's
// page stays here while it reads software's proof and changelog views, which no act gives a pack (packs/surface/kernel/public.ts):
// this route names them (PAGE_VIEWS), and the surface asks each as anyone.
// Everything is read as the public role sees the map (root.public_product, the surface's), so there is nothing here to
// guard: what is not public is not there to be found.

import type { KernelContext } from '#pelago/kernel';
import { pageMarks } from './page-marks.ts';

/** What a GET is answered on: a response as node's http server hands it, only what is written here. */
export interface Reply {
  writeHead(status: number, headers: Record<string, string>): Reply;
  end(body?: string | Buffer): unknown;
}
/** The views a product's page is read from: what its tests found, and what it shipped (the software pack's). */
export const PAGE_VIEWS = { proof: 'proof', changelog: 'changelog' };
type Product = { guard: Record<string, string>; policy?: string; found?: boolean; html?: string; page?: Record<string, unknown> | null; picture?: { content_type: string; data: string } | null };

/**
 * Answer a GET under /p/ for a product: its page, its data, or one of its results' pictures. `ctx` is the publish
 * pack's context of the workspace's map, or of none (its workspace field empty) where the server holds no such workspace.
 */
export async function servePublic(ctx: Pick<KernelContext, 'call' | 'workspace'>, res: Reply, match: { workspace: string; id: string; what?: string; extra?: string; build?: string }) {
  const { id, what, extra, build } = match;
  const held = ctx.workspace !== '';
  const product = await ctx.call<unknown, Product>('root.public_product', { id, views: PAGE_VIEWS, ...(what && { what }), ...(extra && { extra }), ...(build && { build }) });
  const { guard } = product;
  const none = () => res.writeHead(404, { ...guard, 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
  if (!what) {
    // A product's page reads its data once open. What is not public, or not there, has no page at all.
    res.writeHead(product.found ? 200 : 404, { ...guard, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': String(product.policy) });
    return res.end(String(product.html));
  }
  if (!held) return none();
  if (what === 'data') {
    if (!product.page) return none();
    const look = await ctx.call<Record<string, unknown> | undefined, Record<string, unknown>>('page.look', undefined);
    // Read live, with the marks its part draws it with now (./page-marks.ts): its reader is sent marks, never the part's code.
    const page = { ...product.page, ...look };
    return res.writeHead(200, { ...guard, 'content-type': 'application/json', 'cache-control': 'no-cache' }).end(JSON.stringify({ ...page, ...(await pageMarks(ctx, 'page.public', page, { published: true })) }));
  }
  if (what !== 'picture') return none();
  // Anything public in its own right shows its own picture.
  const picture = product.picture;
  if (!picture) return none();
  return res.writeHead(200, { ...guard, 'content-type': picture.content_type, 'cache-control': 'public, max-age=300', 'content-security-policy': "default-src 'none'" }).end(Buffer.from(picture.data, 'base64'));
}
