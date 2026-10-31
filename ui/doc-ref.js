// Where a reader of a public page came from, named in its address (?ref=), goes with them: a link they follow to this
// site, or to a name under it, carries it on. Nothing is kept, and a link anywhere else is left as it is.

const REF = /^[A-Za-z0-9_-]{1,40}$/;

/** A link's address as the reader of the page at `here` follows it. */
export function carried(href, here) {
  const from = new URL(here);
  const ref = from.searchParams.get('ref');
  if (!ref || !REF.test(ref)) return href;
  const to = new URL(href, from);
  const site = from.hostname.replace(/^www\./, '');
  if (!/^https?:$/.test(to.protocol) || (to.hostname !== site && !to.hostname.endsWith(`.${site}`))) return href;
  to.searchParams.set('ref', ref);
  return to.href;
}
