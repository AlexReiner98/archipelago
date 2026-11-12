// What Archipelago is called and how it is described, everywhere it is listed: one file, listing.json, that the
// plugin, the MCP Registry's server.json, /llms.txt and the install page are made from, and that every directory's
// form is filled in from. test/listing.test.ts refuses a listing that says something else.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Listing = {
  name: string;
  title: string;
  /** The shortest name a directory takes beside the title (OpenAI's shortDescription, 30). */
  short: string;
  registry_name: string;
  publisher: string;
  tagline: string;
  summary: string;
  description: string;
  not: string;
  /** The plugin marketplaces' one category. */
  category: string;
  /** What a directory that takes several files it under, first first. */
  categories: string[];
  keywords: string[];
  license: string;
  urls: { site: string; app: string; install: string; docs: string; mcp: string; repository: string; privacy: string; terms: string; support: string };
  /** A square PNG of 512 to 2048 px, under 2 MB: the plugin directory's bounds, the tightest any takes. */
  icon: string;
};

/** The longest each may be: the tightest any directory takes (the summary is the MCP Registry's description, 100). */
export const LIMITS = { title: 60, short: 30, tagline: 60, summary: 100, description: 2000 } as const;

export const LISTING: Listing = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'listing.json'), 'utf8'));
