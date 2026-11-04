// Where a reader of a public page came from, as a tag: the page's own ?ref=, else its ?utm_source= (an AI search adds
// one), else the other site that sent them. One rule for both sides: the page carries the tag on in its links
// (ui/doc-ref.js) and the server counts a visit under it (src/visits.ts), so they never disagree. Served to the page as
// /source-tag.js, its types stripped (src/ui-files.ts). It imports nothing, so it runs in a browser as it is: keep it so.

/** What a tag may be: a short word of letters, digits, _ and -. */
export const REF = /^[A-Za-z0-9_-]{1,40}$/;

/** A host as a tag: its name without www. and the last label, so chatgpt.com is chatgpt, news.ycombinator.com ycombinator. */
export function hostTag(host: string): string | null {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.').slice(0, -1);
  const name = (labels.at(-1) ?? '').replace(/[^a-z0-9-]/g, '');
  return REF.test(name) ? name : null;
}

/** Whether `host` is the site or a name under it. */
export const within = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

/** Where the reader of the page at `from` on `site`, sent by `referrer` (the page before, or ''), came from, or null. */
export function sourceOf(from: URL, site: string, referrer: string): string | null {
  const ref = from.searchParams.get('ref');
  if (ref) return REF.test(ref) ? ref : null;
  const utm = from.searchParams.get('utm_source');
  // A site's address (chatgpt.com) is named as a referrer is; a plain word (newsletter) is the tag itself.
  if (utm) return utm.includes('.') ? hostTag(utm) : REF.test(utm) ? utm.toLowerCase() : null;
  let by: string;
  try { by = new URL(referrer).hostname; } catch { return null; }
  return by && !within(by, site) ? hostTag(by) : null;
}
