// A server stopping lets the requests in hand finish before the databases they read are closed. It takes no new
// connection and drops the idle ones at once; a request in hand has DRAIN_MS to be answered, and what is still open
// after that (a watch held open, a stream) is cut. Closing the pools under a request in hand would answer it with
// "Cannot use a pool after calling end on the pool": the deploy stops the old server while the proxy still has
// requests on it.

import type { Server } from 'node:http';

/** How long the requests in hand have to be answered once the server stops: well inside the deploy's stop timeout (30 s). */
export const DRAIN_MS = 10_000;

/** Stop taking requests, and wait for those in hand to be answered, at most `ms`. */
export async function drained(server: Server, ms = DRAIN_MS): Promise<void> {
  const closed = new Promise<void>((done) => server.close(() => done()));
  server.closeIdleConnections();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([closed, new Promise<void>((done) => (timer = setTimeout(done, ms)))]);
  clearTimeout(timer);
  server.closeAllConnections();
}
