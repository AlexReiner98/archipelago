// A workspace's public site at a domain of its own: the server's configuration ties a domain to a workspace
// (PELAGO_SITES: archipelago.tools=archipelago), and the reader pack (packs/reader) answers there. What the kernel
// keeps of it: which domain serves which workspace, where a page of it is read, and the header and footer a preview
// of a page is drawn with (/preview/<id>), read through the narrow functions that give what was published.

import { publicViewAt, publicViews } from '../../../src/public-view-store.ts';
import type { Workspaces } from '../../../src/workspaces.ts';

/** The address word of a site's front page, read at /. */
export const HOME = 'home';
/** The address word of the page every page of a site ends with: its legal and contact lines, say. */
export const FOOTER = 'footer';
const PARAGRAPH = '\n\n';

/** Domains and the workspace each serves, from "archipelago.tools=archipelago,docs.example.com=acme". */
export function readSites(text: string | undefined): Record<string, string> {
  const pairs = (text ?? '').split(',').map((pair) => pair.split('=').map((part) => part.trim().toLowerCase()));
  return Object.fromEntries(pairs.filter(([host, ws]) => host && ws));
}

/** Where a page of a site is read: its front page at /, every other at /<path>. */
export const siteHref = (path: string) => (path === HOME ? '/' : `/${path}`);

/**
 * The site's name, the pages its header shows, in their menu's order, each as an address on this site, and what every
 * page ends with: the words of the page published at /footer, as published.
 */
export async function siteNav(workspaces: Workspaces, workspace: string, href: (page: { id: string; path: string | null }) => string | null) {
  const pelago = (await workspaces.get(workspace)).pelago;
  const pages = await publicViews(pelago);
  const home = pages.find((page) => page.path === HOME);
  const foot = pages.some((page) => page.path === FOOTER) ? ((await publicViewAt(pelago, FOOTER)) as { parts?: { text?: string }[] } | null) : null;
  const footer = (foot?.parts ?? []).flatMap((part) => (typeof part.text === 'string' ? [part.text] : [])).join(PARAGRAPH);
  return {
    ...(footer && { footer }),
    name: (await workspaces.list()).find((ws) => ws.id === workspace)?.name ?? workspace,
    home: home ? href(home) : null,
    pages: pages.filter((page) => page.menu != null && page.path !== HOME).map((page) => ({ title: page.title, href: href(page) })).filter((page) => page.href),
  };
}
