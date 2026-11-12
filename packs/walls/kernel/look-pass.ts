// The look pass, the trusted half of a look (docs/kernel-packs.md, "Where each module goes": looks, `passFor` stays
// in walls): a token for one drawing, minted for the asking agent's own person (never an admin), good for
// LOOK_PASS_MS and for the reads a canvas makes (LOOK_READS) and nothing else. The server's gate reads it here
// (readPass, passWorkspace); the looks pack draws with it (packs/look_draw/kernel/looks.ts).

import { sha256Hex, workspaceSecret } from '../../../src/hashes.ts';
import type { Q } from '../../../src/db.ts';
import type { Whose } from '../../../src/presence.ts';
// A pass is kept in the transient store, the database root's (wave 7: the slot walls.pass_store went with it).
import { keep, kept } from '../../database/kernel/transient.ts';

/** How long a look pass reads for: one drawing. */
const LOOK_PASS_MS = 90_000;
const PASS = /^look_([a-z0-9][a-z0-9-]{0,39})_[0-9a-f]{40}$/;

/** What a look pass may call through /api: what the canvas reads to draw a view (the pages ask whether each document is published), and nothing that writes. */
export const LOOK_READS = new Set(['view', 'schema', 'get', 'proposals', 'search', 'picture', 'document', 'events', 'published']);

/** Who a pass reads as: the person whose view it is (null: the map unscoped, as a server with no tokens has it). */
export interface Pass {
  viewer: string | null;
  actor: string;
}

const hashOf = sha256Hex;

/** The workspace a look pass is for, when the token is one. Says nothing about whether it is good. */
export const passWorkspace = (token: string | undefined) => (token ? PASS.exec(token)?.[1] : undefined);

/** Whom a look pass reads as, while it is good. */
export const readPass = (db: Q, token: string) => kept<Pass>(db, `lookpass:${hashOf(token)}`);

/** A look pass for this screen's person, made for `actor`: what the server's Chrome reads with, for one drawing. */
export async function passFor(db: Q, w: Whose, actor: string): Promise<string> {
  const pass = workspaceSecret('look', w.workspace);
  await keep(db, `lookpass:${hashOf(pass)}`, { viewer: w.viewer ?? null, actor } satisfies Pass, LOOK_PASS_MS);
  return pass;
}
