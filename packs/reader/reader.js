// What the reader answers at each address, from the parts the kernel parsed and what the published acts give. `act`
// asks the kernel for one of them; nothing else is read. An address that is not a published document's is passed on
// ({ pass: true }): the kernel answers it as it would with no reader (a product's page, the app's files).

import { publishedPage } from './head.js';

/** The address word of a site's front page, read at /, and of the page every page of a site ends with. */
export const HOME = 'home';
export const FOOTER = 'footer';
/** The address word of the page whose words lead the site's /llms.txt (llmstxt.org), for an agent that lands here. */
export const LLMS = 'llms';
const PARAGRAPH = '\n\n';
const textOf = (doc) => (doc?.parts ?? []).flatMap((part) => (typeof part.text === 'string' ? [part.text] : [])).join(PARAGRAPH);
/** A page that is the site's own, not one of its shared parts. */
const listed = (page) => page.path && page.path !== FOOTER && page.path !== LLMS;
/** What a drawing's code and a picture may be kept for, in seconds: the code is the same for as long as its hash is. */
const FOR_GOOD = 31_536_000;
const PICTURE_KEPT = 300;
const WORKSPACE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ID = /^e_[a-z0-9]{8}$/;
const HASH = /^[0-9a-f]{64}$/;
const PATH = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const WHATS = ['data', 'picture', 'drawing', 'live'];
const NONE = { status: 404, json: { error: 'Not found' } };
const PASS = { pass: true };

/** Where a public item's page is read, and a page of a site: its front page at /, every other at /<path>. */
export const publicPath = (workspace, id) => `/p/${workspace}/${id}`;
export const siteHref = (path) => (path === HOME ? '/' : `/${path}`);
/** Where a page's section's figure is read, below the page's own address. */
export const pictureAt = (page, section) => `${page.replace(/\/$/, '')}/picture/${section}`;

/** The section a page's style names for its link picture (page.share), when the page holds it with a figure. */
export const shareOf = (doc, share) =>
  typeof share === 'string' && doc.parts.some((p) => 'section' in p && p.section.id === share && p.section.picture) ? share : undefined;

/**
 * The site's name, the pages its header shows, in their menu's order, each at the address href gives it, and what
 * every page ends with: the words of the page published at /footer, as published.
 */
export async function nav(act, workspace, name, href) {
  const pages = (await act('site.pages', { workspace })) ?? [];
  const home = pages.find((page) => page.path === HOME);
  const foot = pages.some((page) => page.path === FOOTER) ? await act('published.at', { workspace, path: FOOTER }) : null;
  const footer = (foot?.parts ?? []).flatMap((part) => (typeof part.text === 'string' ? [part.text] : [])).join(PARAGRAPH);
  return {
    ...(footer && { footer }),
    name: name ?? workspace,
    home: home ? href(home) : null,
    pages: pages.filter((page) => page.menu != null && page.path !== HOME).map((page) => ({ title: page.title, href: href(page) })).filter((page) => page.href),
  };
}

/** A document's data with each drawing's code read below another address of it. */
function rehomed(doc, from, to) {
  if (!doc.lenses) return doc;
  const lenses = Object.fromEntries(
    Object.entries(doc.lenses).map(([id, lens]) => {
      const src = lens.style?.drawing?.src;
      if (typeof src !== 'string' || !src.startsWith(`${from}/drawing/`)) return [id, lens];
      return [id, { ...lens, style: { ...lens.style, drawing: { ...lens.style.drawing, src: `${to.replace(/\/$/, '')}${src.slice(from.length)}` } } }];
    }),
  );
  return { ...doc, lenses };
}

const picture = (found) => (found ? { picture: found, cache: PICTURE_KEPT } : null);
const drawing = (code) => (code ? { json: code, cache: FOR_GOOD } : null);

/** /p/<workspace>/<id>[/<what>[/<extra>]]: a published document's page, its data, a picture, a drawing, its stream. */
export async function pageOf(parts, act, template) {
  const { workspace, id, what, extra, name, named, domain } = parts;
  if (!WORKSPACE.test(workspace ?? '') || !ID.test(id ?? '') || (what && !WHATS.includes(what))) return PASS;
  // Its stream is the kernel's, which checks itself that the document is published: no read first, so it opens at once.
  if (what === 'live') return { stream: true };
  // A document is read as it was last published, never as the map has it now.
  const read = await act('published.read', { workspace, id });
  if (!read) return PASS;
  // Its id is its address: the page is not given it twice.
  const { id: _id, ...doc } = read;
  const path = publicPath(workspace, id);
  if (what === 'drawing') return (extra && HASH.test(extra) && drawing(await act('published.drawing', { workspace, id, hash: extra }))) || NONE;
  // A section of the document shows its figure; anything public in its own right is the kernel's.
  if (what === 'picture') return (extra && ID.test(extra) && picture(await act('published.picture', { workspace, id, section: extra }))) || PASS;
  const site = await nav(act, workspace, name, (page) => publicPath(workspace, page.id));
  const data = { ...doc, site };
  if (what === 'data') return { json: data };
  // Its address to keep: on its site's domain where it has one there, else on this server's name.
  const here = named ? `https://${named}${path}` : path;
  const canonical = domain && doc.path ? `https://${domain}${siteHref(doc.path)}` : here;
  const share = shareOf(doc, doc.share);
  return { html: publishedPage(template, doc, canonical, site.name, data, share && pictureAt(here, share)) };
}

const xml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Any address on a site's domain: each published document at its address word, the one whose path is home at /, with
 * a sitemap for search engines. An address no published page has is not the site's.
 */
export async function siteOf(parts, act, template) {
  const { workspace, path: pathname = '/', host, name, app } = parts;
  const origin = `https://${host}`;
  if (pathname === '/robots.txt') return { text: `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`, type: 'text/plain' };
  if (pathname === '/sitemap.xml') {
    const urls = ((await act('site.pages', { workspace })) ?? []).filter(listed).map((page) => `  <url><loc>${xml(origin + siteHref(page.path))}</loc><lastmod>${new Date(page.published_at).toISOString().slice(0, 10)}</lastmod></url>`);
    return { text: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`, type: 'application/xml', cache: PICTURE_KEPT };
  }
  // An agent told the site's name guesses /install: it is the app's install page and its scripts, unless a page has that address.
  const install = /^\/install(\.md|\.ps1|\.sh)?$/.exec(pathname);
  if (install && app && !(install[1] === undefined && (await act('published.at', { workspace, path: 'install' })))) return { redirect: `${app}/connect${pathname}`, status: 302 };
  // For an agent: the words of the page published at /llms, as published, then every page by its title and address.
  if (pathname === '/llms.txt') {
    const pages = ((await act('site.pages', { workspace })) ?? []).filter(listed);
    const lead = textOf(await act('published.at', { workspace, path: LLMS }));
    const list = pages.map((page) => `- [${page.title}](${origin + siteHref(page.path)})`).join('\n');
    const head = lead.startsWith('# ') ? lead : `# ${name ?? workspace}${lead ? PARAGRAPH + lead : ''}`;
    const installs = app && !lead.includes('/connect/install') ? `${PARAGRAPH}## Install${PARAGRAPH}- [Install Archipelago for an agent](${app}/connect/install)` : '';
    return { text: `${head}${installs}${PARAGRAPH}## Pages${PARAGRAPH}${list}\n`, type: 'text/plain', cache: PICTURE_KEPT };
  }
  const steps = pathname.split('/').filter(Boolean);
  // The front page's data and figures are read at /data and /picture/<id>, as any page's are below its own address.
  const [path, what, extra] = steps.length === 0 || WHATS.includes(steps[0]) ? [HOME, ...steps] : steps;
  const whole = what === 'data' || what === 'live';
  if (steps.length > 3 || (what && !WHATS.includes(what)) || (what && !whole && !extra) || (whole && extra)) return PASS;
  // The front page has one address.
  if (steps[0] === HOME && !what) return { redirect: '/', status: 301 };
  const doc = PATH.test(path) ? await act('published.at', { workspace, path }) : null;
  if (!doc) return steps.length === 0 ? { status: 404, text: 'This site has no front page yet.', type: 'text/plain' } : PASS;
  if (what === 'picture') return (ID.test(extra) && picture(await act('published.picture', { workspace, id: doc.id, section: extra }))) || NONE;
  if (what === 'live') return { stream: true, id: doc.id };
  if (what === 'drawing') return (HASH.test(extra) && drawing(await act('published.drawing', { workspace, id: doc.id, hash: extra }))) || NONE;
  const site = { ...(await nav(act, workspace, name, (page) => (page.path ? siteHref(page.path) : null))), host };
  const data = { ...rehomed(doc, publicPath(workspace, doc.id), siteHref(doc.path)), site };
  if (what === 'data') return { json: data };
  // Where a link to it is posted, it shows the figure its style names (page.share): its own, else the front page's.
  const own = shareOf(doc, doc.share);
  const front = own || doc.path === HOME || typeof doc.share !== 'string' ? undefined : shareOf((await act('published.at', { workspace, path: HOME })) ?? { parts: [] }, doc.share);
  const image = own ? pictureAt(origin + siteHref(doc.path), own) : front && pictureAt(origin, front);
  return { html: publishedPage(template, doc, origin + siteHref(doc.path), site.name, data, image) };
}
