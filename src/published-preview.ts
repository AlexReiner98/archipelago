// A document's preview: the page a reader of the site would be given if it were published now, drawn by the
// published page itself (ui/doc.js at /preview/<id>), for someone signed in. Nothing is published or kept: what
// publishing would freeze (src/published.ts), with the workspace's look and its site's header and footer.

import type { Archipelago } from './pelago.ts';
import { wouldPublish } from './published.ts';
import { pageLook } from './styles.ts';

/** The data a published page would draw from, read now. `nav` gives the site's header and footer (src/site.ts). */
export async function previewOf(l: Archipelago, id: string, nav: () => Promise<Record<string, unknown>>) {
  const given = await wouldPublish(l, id);
  return { ...given, ...(await pageLook(l)), site: await nav() };
}
