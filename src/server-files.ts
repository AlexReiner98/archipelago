// The files a server pack serves (task e_mejvx37k): GET /x/<pack>/files/<id>, and the one mounted at setup on
// /connect/setup.mjs. Each is a file of the pack's files/ folder, sent as it is but for the values the kernel fills in
// ({origin}, {tokens}, {version}, {rules}); its version is the hash of what it would send. A session whose hook says an
// older version is told its folder is behind (src/hook-answers.ts).
//
// A seam for now: no file is served, and the version is the kernel's own setup, which src/connect.ts registers.

import type { ServerResponse } from 'node:http';
import { json, PRIVATE } from './reply.ts';
import type { ServerPackFile } from './server-packs.ts';

export interface FileCall {
  /** The address this server is reached at. */
  origin: string;
  /** Whether this server asks for a token. */
  tokens: boolean;
}

export async function serveFile(res: ServerResponse, _pack: ServerPackFile, _id: string, _at: FileCall): Promise<unknown> {
  return json(res, 404, { error: 'Not found' }, PRIVATE);
}

/** The version of what this server hands out a project, once known. */
let handedOut: string | undefined;
export const handsOut = (version: string) => void (handedOut = version);

/** Whether a session's folder is behind what this server hands out, by the version its hook says. */
export const setupBehind = (said: string | undefined): boolean => handedOut !== undefined && said !== handedOut;
