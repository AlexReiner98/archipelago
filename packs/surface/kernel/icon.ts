// The map's icon, at the addresses a browser's tab and a client listing this server (Claude's connectors, say) look
// for one: the icon of the workspace's style, else its emblem, on the site's own domain the site's, as a PNG.
// Nothing here names which: the style that is the workspace's says (src/styles.ts, iconOf), and the server hands it.

import type { ServerResponse } from 'node:http';

/** Where an icon is looked for: /favicon.ico by browsers and crawlers that read no page, /favicon.png by the pages' own link. */
export const ICON = /^\/favicon\.(ico|png)$/;

/** Answer with the workspace's icon (its style's, as iconOf reads it), or a 404 when its style has none. */
export function serveIcon(res: ServerResponse, png: Buffer | null) {
  if (!png) return res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'This map has no icon.' }));
  return res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" }).end(png);
}
