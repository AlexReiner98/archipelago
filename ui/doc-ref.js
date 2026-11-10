// What a public page's data says its links carry on (data.carry, set by the pack that answered the page): a link its
// reader follows to this site, or to a name under it, takes those words with it as its query. Nothing is kept, and a
// link anywhere else is left as it is.

const within = (host, site) => host === site || host.endsWith(`.${site}`);

/** A link's address as the reader of the page at `here` follows it, carrying the words `carry` names. */
export function carried(href, here, carry) {
  const words = Object.entries(carry && typeof carry === 'object' ? carry : {}).filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && v);
  if (!words.length) return href;
  const from = new URL(here);
  const site = from.hostname.replace(/^www\./, '');
  const to = new URL(href, from);
  if (!/^https?:$/.test(to.protocol) || !within(to.hostname, site)) return href;
  for (const [k, v] of words) to.searchParams.set(k, v);
  return to.href;
}
