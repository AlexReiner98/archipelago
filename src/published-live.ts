// A published page kept open while it is changed: opened with ?live, the page listens here (server-sent events) and
// is told the moment its document is published again, then draws itself anew from its data. Only a page that asks
// listens; what it is told is that there is something new to read, nothing more.

import type { ServerResponse } from 'node:http';

const listening = new Map<string, Set<ServerResponse>>();
/** How often a listening page is sent a comment, so a proxy does not close a quiet stream. */
const KEEP_ALIVE_MS = 25_000;

/** Tell the pages listening to this document that it was published again. */
export function republished(workspace: string, id: string) {
  for (const res of listening.get(`${workspace}/${id}`) ?? []) res.write(`event: published\ndata: ${Date.now()}\n\n`);
}

/** Keep this response open as the stream a page listens to for its document. */
export function listen(res: ServerResponse, workspace: string, id: string, headers: Record<string, string>) {
  const key = `${workspace}/${id}`;
  res.writeHead(200, { ...headers, 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
  res.write(': listening\n\n');
  if (!listening.has(key)) listening.set(key, new Set());
  listening.get(key)!.add(res);
  const alive = setInterval(() => res.write(': still here\n\n'), KEEP_ALIVE_MS);
  res.on('close', () => {
    clearInterval(alive);
    listening.get(key)?.delete(res);
    if (!listening.get(key)?.size) listening.delete(key);
  });
}
