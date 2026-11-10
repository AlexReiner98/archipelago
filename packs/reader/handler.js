// The reader: what anyone may open with no login. The kernel hands it the public addresses (/p/) and a site's domain
// (src/server-mounts.ts), and it reads what was published through the published acts alone (src/server-published.ts):
// it is handed no map, so what is not published is not there to be found. Its page is the shared document page
// (public/page.html, the kernel's ui/doc.html as a reader's), whose scripts the kernel serves. A reader's page load on a
// site with a source tag is counted under it (visit.js), on the site's map, in the stream the manifest names (counts).

import { readFileSync } from 'node:fs';
import { pageOf, siteOf, visitOf } from './reader.js';

const TEMPLATE = readFileSync(new URL('./public/page.html', import.meta.url), 'utf8');

export default {
  page: async (parts, ctx) => ({ answer: await pageOf(parts, (act, input) => ctx.act(act, input), TEMPLATE) }),
  site: async (parts, ctx) => {
    const answer = await siteOf(parts, (act, input) => ctx.act(act, input), TEMPLATE);
    const tag = visitOf(parts, answer);
    // A count that fails to be taken never fails the page.
    if (tag) await ctx.act('count.add', { site: parts.host, key: tag }).catch(() => null);
    return { answer };
  },
};
