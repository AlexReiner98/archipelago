// Where a reader of a public page came from goes with them: a link they follow to this site, or to a name under it,
// carries it on as ?ref=. The page's own ?ref= says it; without one, its ?utm_source= (an AI search adds one), or else
// the other site that sent them. Nothing is kept, and a link anywhere else is left as it is.

const REF = /^[A-Za-z0-9_-]{1,40}$/;

/** A host as a tag: its name without www. and the last label, so chatgpt.com is chatgpt, news.ycombinator.com ycombinator. */
function tag(host) {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.').slice(0, -1);
  const name = (labels.at(-1) ?? '').replace(/[^a-z0-9-]/g, '');
  return REF.test(name) ? name : null;
}

/** Whether `host` is the site or a name under it. */
const within = (host, site) => host === site || host.endsWith(`.${site}`);

/** Where the reader of the page at `from` on `site`, sent by `referrer` (the page before, or ''), came from, or null. */
function source(from, site, referrer) {
  const ref = from.searchParams.get('ref');
  if (ref) return REF.test(ref) ? ref : null;
  const utm = from.searchParams.get('utm_source');
  if (utm) return tag(utm);
  let by;
  try { by = new URL(referrer).hostname; } catch { return null; }
  return by && !within(by, site) ? tag(by) : null;
}

/** A link's address as the reader of the page at `here`, sent there by `referrer`, follows it. */
export function carried(href, here, referrer = '') {
  const from = new URL(here);
  const site = from.hostname.replace(/^www\./, '');
  const ref = source(from, site, referrer);
  if (!ref) return href;
  const to = new URL(href, from);
  if (!/^https?:$/.test(to.protocol) || !within(to.hostname, site)) return href;
  to.searchParams.set('ref', ref);
  return to.href;
}
