// The look pass, the trusted half of a look (docs/kernel-packs.md, "Where each module goes": looks, `passFor` stays
// in walls): a token for one drawing, minted for the asking agent's own person (never an admin), good for
// LOOK_PASS_MS and for the reads a canvas makes (LOOK_READS) and nothing else. The server's gate reads it here
// (readPass, passWorkspace); the looks pack draws with it (packs/look_draw/kernel/looks.ts).

import { sha256Hex, workspaceSecret } from '../../../src/hashes.ts';
import type { Q } from '../../../src/db.ts';
import type { Whose } from '../../../src/presence.ts';

/**
 * The slot `walls.pass_store` (docs/kernel-packs.md, "Slots"): a pass is kept in the transient store, which is the
 * surface's (packs/surface/kernel/transient.ts). It fills this when it loads, so walls keeps a pass without
 * importing above itself.
 */
export interface PassStore {
  keep: (db: Q, key: string, value: unknown, ms: number) => Promise<void>;
  kept: <T>(db: Q, key: string) => Promise<T | undefined>;
}
let store: PassStore | undefined;
export const fillPassStore = (filled: PassStore): void => void (store = filled);
const stored = (): PassStore => {
  if (!store) throw new Error('No store for look passes is loaded: the walls slot walls.pass_store is filled by surface (src/transient.ts).');
  return store;
};
const keep: PassStore['keep'] = (db, key, value, ms) => stored().keep(db, key, value, ms);
const kept = <T>(db: Q, key: string) => stored().kept<T>(db, key);

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
