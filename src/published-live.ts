// A published page kept open while it is changed: opened with ?live, the page listens here (server-sent events) and
// is told the moment its document is published again, then draws itself anew from its data. Only a page that asks
// listens; what it is told is that there is something new to read, nothing more.

import type { ServerResponse } from 'node:http';
import { counted } from './limit.ts';

const listening = new Map<string, Set<ServerResponse>>();
/** How many pages listen from each address (an IPv6 one by its /64): a stream is held open, so it is counted while it lasts. */
const fromAddress = new Map<string, number>();
/** The most pages that listen at once from one address, and to one document: enough for a team, too few to hold the server. */
export const LIVE_EACH = 10;
export const LIVE_DOCUMENT = 500;
/** How often a listening page is sent a comment, so a proxy does not close a quiet stream. */
const KEEP_ALIVE_MS = 25_000;

/** Tell the pages listening to this document that it was published again. */
export function republished(workspace: string, id: string) {
  for (const res of listening.get(`${workspace}/${id}`) ?? []) res.write(`event: published\ndata: ${Date.now()}\n\n`);
}

/** Keep this response open as the stream a page listens to for its document. */
export function listen(res: ServerResponse, workspace: string, id: string, headers: Record<string, string>, from = '') {
  const key = `${workspace}/${id}`;
  const who = counted(from);
  if ((fromAddress.get(who) ?? 0) >= LIVE_EACH || (listening.get(key)?.size ?? 0) >= LIVE_DOCUMENT) {
    return res.writeHead(429, { ...headers, 'content-type': 'application/json', 'retry-after': '60' }).end(JSON.stringify({ error: 'Too many pages are listening already. Reload it in a minute.' }));
  }
  fromAddress.set(who, (fromAddress.get(who) ?? 0) + 1);
  res.writeHead(200, { ...headers, 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
  res.write(': listening\n\n');
  if (!listening.has(key)) listening.set(key, new Set());
  listening.get(key)!.add(res);
  const alive = setInterval(() => res.write(': still here\n\n'), KEEP_ALIVE_MS);
  res.on('close', () => {
    clearInterval(alive);
    const left = (fromAddress.get(who) ?? 1) - 1;
    if (left) fromAddress.set(who, left);
    else fromAddress.delete(who);
    listening.get(key)?.delete(res);
    if (!listening.get(key)?.size) listening.delete(key);
  });
}
