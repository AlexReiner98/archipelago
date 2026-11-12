// The reader: what anyone may open with no login. The kernel hands it the public addresses (/p/) and a site's domain
// (packs/surface/kernel/server-mounts.ts), and it reads public views through the public acts alone (packs/surface/kernel/server-published.ts): it is
// handed no map, so what is not public is not there to be found. Its page is the shared document page
// (public/page.html, the kernel's ui/doc.html as a reader's), whose scripts the kernel serves; a site whose home view is
// drawn by the rails is answered at / by that view baked (baked-site.js). A reader's page load on a site with a source
// tag is counted under it (visit.js), on the site's map, in the stream the manifest names (counts).

import { readFileSync } from 'node:fs';
import { bakedSite } from './baked-site.js';
import { pageOf, siteOf, visitOf } from './reader.js';

const TEMPLATE = readFileSync(new URL('./public/page.html', import.meta.url), 'utf8');

/** Count a reader's visit under the tag they came by, on the map `on` names: a count that fails never fails the page. */
async function counted(parts, answer, on, ctx) {
  const tag = visitOf(parts, answer);
  if (tag) await ctx.act('count.add', { ...on, key: tag }).catch(() => null);
  return { answer };
}

/** A site's address: its home view baked where it is a rails view, else as any page of the site. */
async function site(parts, ctx) {
  const act = (name, input) => ctx.act(name, input);
  const count = (key) => ctx.act('count.add', { site: parts.host, key }).catch(() => null);
  const baked = await bakedSite(parts, act, count).catch((err) => (console.error(`reader: the baked home of ${parts.host}: ${err.message}`), null));
  return baked ?? siteOf(parts, act, TEMPLATE);
}

export default {
  // A public view at /p/ is counted on the map of its workspace's site (parts.domain), as a page of that site is; on a
  // workspace with no site, on its own map.
  page: async (parts, ctx) => counted(parts, await pageOf(parts, (act, input) => ctx.act(act, input), TEMPLATE), parts.domain ? { site: parts.domain } : { workspace: parts.workspace }, ctx),
  site: async (parts, ctx) => counted(parts, await site(parts, ctx), { site: parts.host }, ctx),
};
