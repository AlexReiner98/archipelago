// Visits to a workspace's public site, counted per source tag per day (decision e_vpdytrg5): every page load with a
// tag counts, by the one rule the page carries tags by (src/source-tag.ts). Only the count is kept: no address, no
// browser string, no hash of either. A request is read for whether it is a reader at all, and forgotten.

import type { IncomingHttpHeaders } from 'node:http';
import type { Archipelago } from './pelago.ts';
import { sourceOf } from './source-tag.ts';
import { opEntries, type OpFact } from './streams.ts';

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

/** Add visits to a tag's count for a day, in memory until it is written down. */
export function countVisit(workspace: string, tag: string, day = dayOf(), n = 1) {
  const counts = pending.get(workspace) ?? pending.set(workspace, new Map()).get(workspace)!;
  const key = `${tag} ${day}`;
  counts.set(key, (counts.get(key) ?? 0) + n);
}

const rowOf = (key: string, n: number) => ({ tag: key.split(' ')[0], day: key.split(' ')[1], n });

/** The visits held in memory for a workspace, as rows, without taking them. */
export const heldVisits = (workspace: string) => [...(pending.get(workspace) ?? [])].map(([key, n]) => rowOf(key, n));

/** Count a request for a site's page, if it is a reader's and carries a tag. */
export function onSitePage(workspace: string, host: string, url: URL, req: { method?: string; headers: IncomingHttpHeaders }) {
  if (!isVisit(req)) return;
  const tag = visitTag(url, host, req.headers);
  if (tag) countVisit(workspace, tag);
}

/** The most rows a stream entry holds, and a read answers. */
export const VISIT_ROWS = 1000;
/** Each count's fact names its tag so: a tag is never taken for an item's id (and sealed with its key). */
const ID = 'tag:';

type Opened = { pelago: Pick<Archipelago, 'record' | 'db'> };

/** Write down what each workspace has counted since the last time: one entry of the visits stream each, adding to the day. */
export async function flushVisits(open: (workspace: string) => Promise<Opened>) {
  for (const [workspace, counts] of [...pending]) {
    pending.delete(workspace);
    const facts = [...counts].map(([key, n]): OpFact => { const r = rowOf(key, n); return ['+', ID + r.tag, r.day, r.n]; });
    try {
      const { pelago } = await open(workspace);
      for (let i = 0; i < facts.length; i += VISIT_ROWS) await pelago.record('visits', 'system', facts.slice(i, i + VISIT_ROWS));
    } catch (err) {
      // Kept for the next minute rather than lost.
      for (const [key, n] of counts) { const r = rowOf(key, n); countVisit(workspace, r.tag, r.day, r.n); }
      console.error(`writing down the visits of ${workspace} failed:`, err);
    }
  }
}

/** Flush the counts each minute, until what this returns is called, which flushes what is left. */
export function keepVisits(open: (workspace: string) => Promise<Opened>, everyMs = 60_000): () => Promise<void> {
  const timer = setInterval(() => void flushVisits(open), everyMs);
  timer.unref();
  return () => (clearInterval(timer), flushVisits(open));
}

/**
 * The visits written down after a position of the stream, summed per tag per day: each n is what was added to that
 * day since `after`. At most VISIT_ROWS rows, whole entries only; `pos` is the last entry read, to ask from next.
 */
export async function visitsSince(pelago: Pick<Archipelago, 'db'>, after = 0): Promise<{ counts: { tag: string; day: string; n: number }[]; pos: number }> {
  const entries = await opEntries(pelago.db, 'visits', { from: after + 1, limit: VISIT_ROWS });
  const sum = new Map<string, number>();
  let pos = after;
  for (const e of entries) {
    const added = e.facts.flatMap((f) => (f[0] === '+' && f[1].startsWith(ID) ? [[`${f[1].slice(ID.length)} ${f[2]}`, Number(f[3])] as const] : []));
    if (new Set([...sum.keys(), ...added.map(([key]) => key)]).size > VISIT_ROWS) break;
    for (const [key, n] of added) sum.set(key, (sum.get(key) ?? 0) + n);
    pos = e.pos;
  }
  return { counts: [...sum].map(([key, n]) => rowOf(key, n)), pos };
}
