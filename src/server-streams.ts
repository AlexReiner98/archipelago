// The streams a server pack's page listens on (task e_qsyd4pr4): GET /x/<pack>/<stream>/<workspace>/<id>, server-sent
// events the kernel holds and writes, with the limits a published page's stream has (src/published-live.ts). A stream
// on "published" is told when that document is published again, and nothing more. Pack code never holds a connection.
//
// A seam for now: a declared stream answers 404 until it is built.

import type { ServerResponse } from 'node:http';
import { json, PRIVATE } from './reply.ts';
import type { ServerPackFile } from './server-packs.ts';

export interface StreamCall {
  workspace: string;
  id: string;
  /** Where the listener asks from, for the limit on how many listen from one address. */
  from?: string;
}

export async function serveStream(res: ServerResponse, _pack: ServerPackFile, _stream: string, _at: StreamCall): Promise<unknown> {
  return json(res, 404, { error: 'Not found' }, PRIVATE);
}
