// How the server answers in JSON, and the headers every answer it writes by hand starts from: never sniffed for
// another type, never telling the next site where its reader came from. A route adds what it needs beyond them (a
// policy, a cache rule) and never leaves these out.

import type { ServerResponse } from 'node:http';

/** What every answer is sent with. */
export const GUARD = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } as const;
/** An answer nobody keeps: what is for one reader, or holds a secret. */
export const PRIVATE = { ...GUARD, 'cache-control': 'no-store' } as const;
/** A private answer that no search engine lists either. */
export const UNLISTED = { ...PRIVATE, 'x-robots-tag': 'noindex' } as const;

/** Answer with JSON: the guard, what the route adds, and the type. */
export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): ServerResponse {
  return res.writeHead(status, { ...GUARD, ...headers, 'content-type': 'application/json' }).end(JSON.stringify(body));
}
