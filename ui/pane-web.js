// A web page an agent shows in a pane (report show with url): framed beside the map, so the owner watches a build as
// it is built (the owner, 3 Nov 2026, e_qenq3hxg). Its address is `w?url=…` (src/view-address.ts). The frame is
// sandboxed and sends no referrer; this server's own pages are drawn as what they are, never framed; and a site that
// refuses to be framed stays blank, so the pane's ↗ opens it in a window of its own.

import { h } from './base.js';

/** What a framed page may do: run, keep its own origin (a dev server's reload needs it), take a form, open a window. */
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';

/** Frame `url` in pane `entry` (ui/panes.js) in place of its canvas, named by its host; no url puts the canvas back. */
export function frameIn(entry, url) {
  const was = entry.web?.dataset.url;
  if (was === url) return;
  entry.web?.remove();
  entry.out?.remove();
  delete entry.web;
  delete entry.out;
  entry.body.hidden = Boolean(url);
  if (!url) return;
  const at = new URL(url);
  entry.name.textContent = at.host || url;
  entry.name.title = `${url}: drag to dock it elsewhere`;
  const own = at.origin === location.origin;
  entry.web = own
    ? h('div', { class: 'pane-web error', 'data-url': url }, 'This server’s pages open as what they are, not in a frame.')
    : h('iframe', { class: 'pane-web', 'data-url': url, sandbox: SANDBOX, referrerpolicy: 'no-referrer', title: url, src: url });
  entry.out = h('a', { class: 'pane-act', href: url, target: '_blank', rel: 'noopener noreferrer', title: 'Open it in a window of its own (a site that refuses to be framed stays blank here)', 'aria-label': 'Open it in a window of its own' }, '↗');
  entry.body.after(entry.web);
  entry.mark.after(entry.out);
  // Framed just now: the show that framed it loads it once.
  entry.fresh = true;
  queueMicrotask(() => delete entry.fresh);
}

/** Load the page framed in pane `entry` again: an agent showed it again, after a build. */
export function reframe(entry) {
  if (entry?.web?.tagName === 'IFRAME' && !entry.fresh) entry.web.src = entry.web.dataset.url;
}
