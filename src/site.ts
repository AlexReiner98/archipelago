// A workspace's public site at a domain of its own. The server's configuration ties a domain to a workspace
// (PELAGO_SITES: archipelago.tools=archipelago); there each published document is read at its address word, the one
// whose path is home at /, with a sitemap for search engines. Read as /p/ reads them (src/public-route.ts): through
// narrow functions that give what was published, nothing of the map as it is now. The app keeps its own address.

import type { ServerResponse } from 'node:http';
import type { Part } from './documents.ts';
import { GUARD, POLICY } from './public-document.ts';
import { listen } from './published-live.ts';
import { drawingCode, pageData, pictureAt, publishedPage, shareOf } from './published-page.ts';
import { publishedAt, publishedPicture, sitePages } from './published.ts';
import { pageLook } from './styles.ts';
import type { Workspaces } from './workspaces.ts';

/** The address word of a site's front page, read at /. */
export const HOME = 'home';
/** The address word of the page every page of a site ends with: its legal and contact lines, say. */
export const FOOTER = 'footer';
const PARAGRAPH = '\n\n';

/** Domains and the workspace each serves, from "archipelago.tools=archipelago,docs.example.com=acme". */
export function readSites(text: string | undefined): Record<string, string> {
  const pairs = (text ?? '').split(',').map((pair) => pair.split('=').map((part) => part.trim().toLowerCase()));
  return Object.fromEntries(pairs.filter(([host, ws]) => host && ws));
}

/** Where a page of a site is read: its front page at /, every other at /<path>. */
export const siteHref = (path: string) => (path === HOME ? '/' : `/${path}`);

/**
 * The site's name, the pages its header shows, in their menu's order, each as an address on this site, and what every
 * page ends with: the words of the page published at /footer, as published.
 */
export async function siteNav(workspaces: Workspaces, workspace: string, href: (page: { id: string; path: string | null }) => string | null) {
  const pelago = (await workspaces.get(workspace)).pelago;
  const pages = await sitePages(pelago);
  const home = pages.find((page) => page.path === HOME);
  const foot = pages.some((page) => page.path === FOOTER) ? ((await publishedAt(pelago, FOOTER)) as { parts?: { text?: string }[] } | null) : null;
  const footer = (foot?.parts ?? []).flatMap((part) => (typeof part.text === 'string' ? [part.text] : [])).join(PARAGRAPH);
  return {
    ...(footer && { footer }),
    name: (await workspaces.list()).find((ws) => ws.id === workspace)?.name ?? workspace,
    home: home ? href(home) : null,
    pages: pages.filter((page) => page.menu != null && page.path !== HOME).map((page) => ({ title: page.title, href: href(page) })).filter((page) => page.href),
  };
}

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Answer a GET on a site's domain, or say it is not the site's (false), so the server answers it as on any other
 * name: the page's own scripts and styles are served by name, as everywhere.
 */
export async function serveSite(res: ServerResponse, pathname: string, at: { host: string; workspace: string; workspaces: Workspaces }): Promise<boolean> {
  const parts = pathname.split('/').filter(Boolean);
  const origin = `https://${at.host}`;
  const send = (status: number, type: string, body: string | Buffer, more: Record<string, string> = {}) => (res.writeHead(status, { ...GUARD, 'content-type': type, ...more }).end(body), true);
  if (!(await at.workspaces.has(at.workspace))) return false;
  const pelago = (await at.workspaces.get(at.workspace)).pelago;
  if (pathname === '/robots.txt') return send(200, 'text/plain; charset=utf-8', `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
  if (pathname === '/sitemap.xml') {
    const urls = (await sitePages(pelago)).filter((page) => page.path && page.path !== FOOTER).map((page) => `  <url><loc>${xml(origin + siteHref(page.path!))}</loc><lastmod>${new Date(page.published_at).toISOString().slice(0, 10)}</lastmod></url>`);
    return send(200, 'application/xml; charset=utf-8', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`, { 'cache-control': 'public, max-age=300' });
  }
  // The front page's data and figures are read at /data and /picture/<id>, as any page's are below its own address.
  const [path, what, extra] = parts.length === 0 || ['data', 'picture', 'drawing', 'live'].includes(parts[0]) ? [HOME, ...parts] : parts;
  const whole = what === 'data' || what === 'live';
  if (parts.length > 3 || (what && !['data', 'picture', 'drawing', 'live'].includes(what)) || (what && !whole && !extra) || (whole && extra)) return false;
  // The front page has one address.
  if (parts[0] === HOME && !what) return send(301, 'text/plain; charset=utf-8', 'Moved', { location: '/' });
  const doc = (await publishedAt(pelago, path)) as ({ id: string; title: string; parts: Part[]; path: string } & Record<string, unknown>) | null;
  // An address no published page has is not the site's: the server answers it as it would anywhere.
  if (!doc) return parts.length === 0 ? send(404, 'text/plain; charset=utf-8', 'This site has no front page yet.') : false;
  if (what === 'picture') {
    const picture = await publishedPicture(pelago, doc.id, extra);
    return picture ? send(200, picture.content_type, picture.bytes, { 'cache-control': 'public, max-age=300', 'content-security-policy': "default-src 'none'" }) : send(404, 'application/json', JSON.stringify({ error: 'Not found' }));
  }
  if (what === 'live') return (listen(res, at.workspace, doc.id, GUARD), true);
  if (what === 'drawing') {
    const code = drawingCode(doc, extra);
    return code ? send(200, 'application/json', JSON.stringify(code), { 'cache-control': 'public, max-age=31536000, immutable' }) : send(404, 'application/json', JSON.stringify({ error: 'Not found' }));
  }
  const site = { ...(await siteNav(at.workspaces, at.workspace, (page) => (page.path ? siteHref(page.path) : null))), host: at.host };
  const look = await pageLook(pelago, doc);
  const data = pageData({ ...doc, ...look, site }, siteHref(doc.path));
  if (what === 'data') return send(200, 'application/json', JSON.stringify(data), { 'cache-control': 'no-cache' });
  // Where a link to it is posted, it shows the figure its style names (page.share): its own, else the front page's.
  const own = shareOf(doc, look.share);
  const front = own || doc.path === HOME || typeof look.share !== 'string' ? undefined : shareOf(((await publishedAt(pelago, HOME)) as { parts: Part[] } | null) ?? { parts: [] }, look.share);
  const image = own ? pictureAt(origin + siteHref(doc.path), own) : front && pictureAt(origin, front);
  const page = await publishedPage(doc, origin + siteHref(doc.path), site.name, data, image);
  return send(200, 'text/html; charset=utf-8', page, { 'cache-control': 'no-store', 'content-security-policy': POLICY });
}
