// A document's preview: the page a reader of the site would be given if it were published now, drawn by the
// published page itself (packs/surface/page/frozen-page.js at /preview/<id>), for someone signed in. Nothing is published or kept: what
// publishing would freeze (./published-freeze.ts), with the workspace's look (the styles pack's page.look) and its
// site's header and footer.

import type { KernelContext } from '#pelago/kernel';
import { wouldPublish } from './published-freeze.ts';
import { pageMarks } from './page-marks.ts';

/** The data a published page would draw from, read now. `nav` gives the site's header and footer (./site.ts). */
export async function previewOf(ctx: KernelContext, id: string, nav: () => Promise<Record<string, unknown>>) {
  const given = await wouldPublish(ctx, id);
  const page = { ...given, ...(await ctx.call<Record<string, unknown>, Record<string, unknown>>('page.look', { ...given, id })) };
  // Drawn with the marks publishing it would keep (./page-marks.ts).
  return { ...page, ...(await pageMarks(ctx, 'page.doc', page, { preview: true })), site: await nav() };
}
