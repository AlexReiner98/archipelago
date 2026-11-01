// A view drawn inline in a chat, through the MCP Apps extension (SEP-1865, stable 2026-01-26): one tool, draw, names
// one ui:// resource, the page in ui/mcp-view.html, and a host that draws Apps opens it beside each call of draw. The
// extension ties a page to a tool, not a call, so draw is a tool of its own and no other tool names the page: an
// ordinary call opens nothing. A host that does not draw Apps has draw's words.
//
// The resource holds no data and no token. It is told of the call by the host, and it asks the server, by
// the host, for a look (src/looks.ts): the server's own browser draws it in the sandbox, as the agent sees the map, and
// the page mounts the marks that come back (ui/look-marks.js), or the picture of a drawing that has none. No drawing's
// code runs in the host's frame: it could not (no worker, no second origin), and a style's code runs behind its two
// walls or not at all. The drawing is static, as a published page's still frame is.
//
// The server keeps no session, so it cannot ask what a client said it supports before listing its tools, as the
// extension suggests: a tool's _meta goes to every client, and one that does not draw Apps does not read it.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const VIEW_URI = 'ui://pelago/view';
export const VIEW_TYPE = 'text/html;profile=mcp-app';

/** What the server says it speaks. */
export const VIEW_CAPABILITY = { 'io.modelcontextprotocol/ui': { mimeTypes: [VIEW_TYPE] } };

/** What a tool's listing carries for this: only draw names the page. */
export const toolView = (tool: string) => (tool === 'draw' ? { _meta: { ui: { resourceUri: VIEW_URI } } } : {});

/** What the host is told of the page: it reaches nothing outside itself. */
const META = { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }, prefersBorder: false } };

/** The page's policy: only its own script (by its hash), and nothing fetched, framed or sent, whatever the host allows. */
const policyFor = (script: string) =>
  [
    "default-src 'none'",
    `script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`,
    "style-src 'unsafe-inline'",
    'img-src data:',
    "connect-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

let page: string | undefined;

/** The page, as a host is given it. */
export function viewPage(): string {
  if (page) return page;
  // A checkout may hold it with CRLF, and a browser hashes a script with LF.
  const file = readFileSync(join(import.meta.dirname, '..', 'ui', 'mcp-view.html'), 'utf8').replace(/\r\n/g, '\n');
  const script = /<script>([\s\S]*?)<\/script>/.exec(file)?.[1];
  if (!script) throw new Error('ui/mcp-view.html has no script.');
  page = file.replace('{{policy}}', policyFor(script));
  return page;
}

/** Offer the page as a resource on this request's server. */
export function registerView(mcp: McpServer): void {
  mcp.registerResource('view', VIEW_URI, { title: 'A view of the map', description: 'Draws a view of the map in the chat that asked for it.', mimeType: VIEW_TYPE, _meta: META }, async () => ({
    contents: [{ uri: VIEW_URI, mimeType: VIEW_TYPE, text: viewPage(), _meta: META }],
  }));
}
