// The reader: what anyone may open with no login. The kernel hands it the public addresses (/p/) and a site's domain
// (src/server-mounts.ts), and it reads what was published through the published acts alone (src/server-published.ts):
// it is handed no map, so what is not published is not there to be found. Its page is the shared document page
// (public/page.html, the kernel's ui/doc.html as a reader's), whose scripts the kernel serves.

import { readFileSync } from 'node:fs';
import { pageOf, siteOf } from './reader.js';

const TEMPLATE = readFileSync(new URL('./public/page.html', import.meta.url), 'utf8');

export default {
  page: async (parts, ctx) => ({ answer: await pageOf(parts, (act, input) => ctx.act(act, input), TEMPLATE) }),
  site: async (parts, ctx) => ({ answer: await siteOf(parts, (act, input) => ctx.act(act, input), TEMPLATE) }),
};
