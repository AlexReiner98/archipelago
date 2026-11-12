// The streams a server pack's page listens on (task e_qsyd4pr4): GET /x/<pack>/<stream>/<workspace>/<id>, server-sent
// events the kernel holds and writes, with the limits a published page's stream has (the publish pack's, surface.published). A stream
// on "published" is told when that document is published again, and nothing more. Pack code never holds a connection:
// the kernel answers the route itself, and closes the pack's streams when the pack goes (closeStreams).
//
// Only a public view is listened to, read as anyone reads it (publicView): what is private, or not
// published, has no stream, the same 404 as nothing at all.

import type { ServerResponse } from 'node:http';
import { published } from './above.ts';
import { publicView } from './public-views.ts';
import { json, PRIVATE } from './reply.ts';
import type { ActPlaces } from './server-acts.ts';
import type { ServerPackFile } from '../../loader/kernel/server-packs.ts';

export interface StreamCall {
  workspace: string;
  id: string;
  /** Where the listener asks from, for the limit on how many listen from one address. */
  from?: string;
  /** The server's workspaces, to read whether the document is published. Without them nothing can be listened to. */
  workspaces?: Pick<ActPlaces, 'has' | 'get'>;
}

export async function serveStream(res: ServerResponse, pack: ServerPackFile, stream: string, at: StreamCall): Promise<unknown> {
  const none = () => json(res, 404, { error: 'Not found' }, PRIVATE);
  const declared = pack.reach.server.streams?.find((s) => s.id === stream);
  if (declared?.on !== 'published' || !at.workspaces || !(await at.workspaces.has(at.workspace).catch(() => false))) return none();
  const { pelago } = await at.workspaces.get(at.workspace);
  if (!(await publicView(pelago, at.id))) return none();
  return (await published()).listenForPack(res, pack.id, at.workspace, at.id, PRIVATE, at.from);
}

/** Close the streams a server pack's pages hold open: the pack has gone. */
export async function closeStreams(pack: string): Promise<void> {
  (await published()).closePackListeners(pack);
}
