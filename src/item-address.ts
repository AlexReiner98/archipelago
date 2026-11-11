// An item's address for a link outside the app (an agent's reply in a chat names an item as a link to it):
// GET /i/<workspace>/<item>, the workspace by the id its MCP address names (src/oauth.ts). It reveals nothing and asks
// for no token: it sends the browser to the page, which opens that workspace on the item (`?link=`, ui/item-link.js),
// in the tab already open on it where there is one.

import { mcpAddress } from './oauth.ts';

const ITEM = /^\/i\/([^/]+)\/(e_[a-z0-9]{8})\/?$/;

/** Where an /i/ address sends the browser, or null when the address is malformed; undefined when it is not one. */
export function itemAddress(path: string): string | null | undefined {
  if (path !== '/i' && !path.startsWith('/i/')) return undefined;
  const m = ITEM.exec(path);
  if (!m || mcpAddress(`/mcp/${m[1]}`)?.workspace !== m[1]) return null;
  return `/?link=${m[1]}#/e/${m[2]}`;
}
