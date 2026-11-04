// Visits to a workspace's public site, counted per source tag per day (decision e_vpdytrg5): every page load with a
// tag counts, by the one rule the page carries tags by (src/source-tag.ts). Only the count is kept: no address, no
// browser string, no hash of either. A request is read for whether it is a reader at all, and forgotten.

import type { IncomingHttpHeaders } from 'node:http';
import { sourceOf } from './source-tag.ts';

/** Agents that fetch a page to show a preview of it, or to index it: not a reader. */
const BOTS = /LinkedInBot|Twitterbot|facebookexternalhit|Slackbot|Discordbot|Cardyb|TelegramBot|WhatsApp|Googlebot|bingbot|bot|crawler|spider|preview/i;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Whether a request is a reader opening a page: a GET, not fetched ahead, not a bot. */
export function isVisit(req: { method?: string; headers: IncomingHttpHeaders }): boolean {
  if (req.method !== 'GET') return false;
  if (/prefetch|prerender/i.test(one(req.headers['sec-purpose'])) || /prefetch/i.test(one(req.headers.purpose))) return false;
  return !BOTS.test(one(req.headers['user-agent']));
}

/** The tag a visit to the page at `url` on the site at `host` is counted under, or null. */
export const visitTag = (url: URL, host: string, headers: IncomingHttpHeaders) => sourceOf(url, host.replace(/^www\./, ''), one(headers.referer));

/** Today as a visit's day: the date in UTC. */
export const dayOf = (at = new Date()) => at.toISOString().slice(0, 10);

/** The visits not yet written down: workspace → "tag day" → how many. */
const pending = new Map<string, Map<string, number>>();

/** Add one visit to a tag's count for a day, in memory until it is written down. */
export function countVisit(workspace: string, tag: string, day = dayOf()) {
  const counts = pending.get(workspace) ?? pending.set(workspace, new Map()).get(workspace)!;
  const key = `${tag} ${day}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** The visits held in memory for a workspace, as rows, without taking them. */
export const heldVisits = (workspace: string) => [...(pending.get(workspace) ?? [])].map(([key, n]) => ({ tag: key.split(' ')[0], day: key.split(' ')[1], n }));

/** Count a request for a site's page, if it is a reader's and carries a tag. */
export function onSitePage(workspace: string, host: string, url: URL, req: { method?: string; headers: IncomingHttpHeaders }) {
  if (!isVisit(req)) return;
  const tag = visitTag(url, host, req.headers);
  if (tag) countVisit(workspace, tag);
}
