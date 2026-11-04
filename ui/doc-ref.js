// Where a reader of a public page came from goes with them: a link they follow to this site, or to a name under it,
// carries it on as ?ref=. Which tag that is is the one rule the server counts visits by (src/source-tag.ts). Nothing
// is kept, and a link anywhere else is left as it is.

import { sourceOf, within } from './source-tag.js';

/** A link's address as the reader of the page at `here`, sent there by `referrer`, follows it. */
export function carried(href, here, referrer = '') {
  const from = new URL(here);
  const site = from.hostname.replace(/^www\./, '');
  const ref = sourceOf(from, site, referrer);
  if (!ref) return href;
  const to = new URL(href, from);
  if (!/^https?:$/.test(to.protocol) || !within(to.hostname, site)) return href;
  to.searchParams.set('ref', ref);
  return to.href;
}
