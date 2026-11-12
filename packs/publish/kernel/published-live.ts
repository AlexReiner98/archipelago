// A published page kept open while it is changed: opened with ?live, the page listens here (server-sent events) and
// is told the moment its document is published again, then draws itself anew from its data. Only a page that asks
// listens; what it is told is that there is something new to read, nothing more. A server pack's page listens the
// same way, on a stream its pack declares (src/server-streams.ts): the kernel holds that connection too, counted
// with the pages', and closes it when the pack goes.

import type { ServerResponse } from 'node:http';
import { isIP } from 'node:net';

const listening = new Map<string, Set<ServerResponse>>();
/** The streams each server pack's pages hold open, so they can be closed when the pack goes. */
const byPack = new Map<string, Set<ServerResponse>>();
/** How many pages listen from each address (an IPv6 one by its /64): a stream is held open, so it is counted while it lasts. */
const fromAddress = new Map<string, number>();
/** The most pages that listen at once from one address, and to one document: enough for a team, too few to hold the server. */
export const LIVE_EACH = 10;
export const LIVE_DOCUMENT = 500;
/** How often a listening page is sent a comment, so a proxy does not close a quiet stream. */
const KEEP_ALIVE_MS = 25_000;

/** Tell the pages listening to this document that it was published again, a pack's pages among them. */
export function republished(workspace: string, id: string) {
  for (const res of listening.get(`${workspace}/${id}`) ?? []) res.write(`event: published\ndata: ${Date.now()}\n\n`);
}

/** Keep this response open as the stream a page listens to for its document. */
export function listen(res: ServerResponse, workspace: string, id: string, headers: Record<string, string>, from = '') {
  hold(res, workspace, id, headers, from);
}

/** Keep this response open as the stream a server pack's page listens to for a document (src/server-streams.ts). */
export function listenForPack(res: ServerResponse, pack: string, workspace: string, id: string, headers: Record<string, string>, from = '') {
  hold(res, workspace, id, headers, from, pack);
}

/** Close every stream a server pack's pages hold: the pack is gone. */
export function closePackListeners(pack: string) {
  for (const res of [...(byPack.get(pack) ?? [])]) res.end();
  byPack.delete(pack);
}

/** An address as it is counted: an IPv6 one by its /64, so one machine is not counted as many (the same as src/limit.ts counted, kept here so the pack imports nothing of the kernel). */
function counted(address: string): string {
  const plain = address.replace(/%.*$/, '');
  if (isIP(plain) !== 6 || /^::ffff:\d+\./i.test(plain)) return address;
  const [head, tail] = plain.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

function hold(res: ServerResponse, workspace: string, id: string, headers: Record<string, string>, from: string, pack?: string) {
  const key = `${workspace}/${id}`;
  // A page that left while its document was read is gone already: counted now, it would never be given back.
  if (res.destroyed || res.closed || res.socket?.destroyed) return;
  const who = counted(from);
  if ((fromAddress.get(who) ?? 0) >= LIVE_EACH || (listening.get(key)?.size ?? 0) >= LIVE_DOCUMENT) {
    return res.writeHead(429, { ...headers, 'content-type': 'application/json', 'retry-after': '60' }).end(JSON.stringify({ error: 'Too many pages are listening already. Reload it in a minute.' }));
  }
  fromAddress.set(who, (fromAddress.get(who) ?? 0) + 1);
  res.writeHead(200, { ...headers, 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
  res.write(': listening\n\n');
  if (!listening.has(key)) listening.set(key, new Set());
  listening.get(key)!.add(res);
  if (pack) {
    if (!byPack.has(pack)) byPack.set(pack, new Set());
    byPack.get(pack)!.add(res);
  }
  const alive = setInterval(() => res.write(': still here\n\n'), KEEP_ALIVE_MS);
  res.on('close', () => {
    clearInterval(alive);
    const left = (fromAddress.get(who) ?? 1) - 1;
    if (left) fromAddress.set(who, left);
    else fromAddress.delete(who);
    listening.get(key)?.delete(res);
    if (!listening.get(key)?.size) listening.delete(key);
    if (pack) {
      byPack.get(pack)?.delete(res);
      if (!byPack.get(pack)?.size) byPack.delete(pack);
    }
  });
}
