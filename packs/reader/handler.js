// The reader: what anyone may open with no login. The kernel hands it the public addresses (/p/) and a site's domain
// (src/server-mounts.ts), and it reads public views through the public acts alone (src/server-published.ts): it is
// handed no map, so what is not public is not there to be found. Its page is the shared document page
// (public/page.html, the kernel's ui/doc.html as a reader's), whose scripts the kernel serves. A reader's page load on a
// site with a source tag is counted under it (visit.js), on the site's map, in the stream the manifest names (counts).

import { readFileSync } from 'node:fs';
import { pageOf, siteOf, visitOf } from './reader.js';

const TEMPLATE = readFileSync(new URL('./public/page.html', import.meta.url), 'utf8');

/** Count a reader's visit under the tag they came by, on the site's map: a count that fails never fails the page. */
async function counted(parts, answer, site, ctx) {
  const tag = visitOf(parts, answer);
  if (tag && site) await ctx.act('count.add', { site, key: tag }).catch(() => null);
  return { answer };
}

export default {
  // A public view at /p/ is counted on the map of its workspace's site (parts.domain), as a page of that site is.
  page: async (parts, ctx) => counted(parts, await pageOf(parts, (act, input) => ctx.act(act, input), TEMPLATE), parts.domain, ctx),
  site: async (parts, ctx) => counted(parts, await siteOf(parts, (act, input) => ctx.act(act, input), TEMPLATE), parts.host, ctx),
};
