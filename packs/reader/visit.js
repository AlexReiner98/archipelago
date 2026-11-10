// Where a reader of a public page came from, as a tag, and whether the request was a reader at all (decision
// e_vpdytrg5). The tag is the page's own ?ref=, else its ?utm_source= (an AI search adds one), else the other site that
// sent them. One rule for both sides: the page is handed the tag to carry on in its links to the site (data.carry), and
// a page load with it is counted under it. Only the count is kept: no address, no browser string, no hash of either.
// The request's words are read for this and forgotten.

/** What a tag may be: a short word of letters, digits, _ and -. */
export const REF = /^[A-Za-z0-9_-]{1,40}$/;

/** Agents that fetch a page to show a preview of it, or to index it: not a reader. */
const BOTS = /LinkedInBot|Twitterbot|facebookexternalhit|Slackbot|Discordbot|Cardyb|TelegramBot|WhatsApp|Googlebot|bingbot|bot|crawler|spider|preview/i;

/** A host as a tag: its name without www. and the last label, so chatgpt.com is chatgpt, news.ycombinator.com ycombinator. */
export function hostTag(host) {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.').slice(0, -1);
  const name = (labels.at(-1) ?? '').replace(/[^a-z0-9-]/g, '');
  return REF.test(name) ? name : null;
}

/** Whether `host` is the site or a name under it. */
export const within = (host, site) => host === site || host.endsWith(`.${site}`);

/** Where the reader of the page with the query `query` on `site`, sent by `referrer` (the page before, or ''), came from, or null. */
export function sourceOf(query, site, referrer) {
  const params = new URLSearchParams(query ?? '');
  const ref = params.get('ref');
  if (ref) return REF.test(ref) ? ref : null;
  const utm = params.get('utm_source');
  // A site's address (chatgpt.com) is named as a referrer is; a plain word (newsletter) is the tag itself.
  if (utm) return utm.includes('.') ? hostTag(utm) : REF.test(utm) ? utm.toLowerCase() : null;
  let by;
  try { by = new URL(referrer ?? '').hostname; } catch { return null; }
  return by && !within(by, site) ? hostTag(by) : null;
}

/** Whether a request is a reader opening a page: not fetched ahead, not a bot. The kernel hands a site GETs alone. */
export function isVisit(request = {}) {
  if (/prefetch|prerender/i.test(request.purpose ?? '')) return false;
  return !BOTS.test(request.agent ?? '');
}

/** The tag the page asked for at `host` with `request` (what the kernel hands of it) is read under, or null. */
export const tagOf = (request, host) => (request ? sourceOf(request.query, (host ?? '').replace(/^www\./, ''), request.referrer) : null);
