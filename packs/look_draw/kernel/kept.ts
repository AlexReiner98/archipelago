// A look kept past LOOK_MS (decision of 18 Nov 2026: a screen keeps the looks it names): asked with keep: true, its
// picture and what was said of it are kept in the workspace's transient store under an id of its own, for the whole
// workspace rather than the screen that took it, so a screen's rounds can name it and anyone who reads the map can see
// it. The rule it keeps (packs/log/kernel/operational.ts, transient): the last KEPT_MOST a workspace kept, each for
// KEPT_MS at most; a keep past that many takes the oldest away. It is operational state, never in a backup or the log.

import { randomBytes } from 'node:crypto';
import type { KernelContext } from '#pelago/kernel';
import { keep, kept, keptWith } from './store.ts';

/** The most looks a workspace keeps: past it, the oldest goes. */
export const KEPT_MOST = 500;
/** The longest a kept look is kept, however few were kept after it. */
export const KEPT_MS = 400 * 24 * 3_600_000;
/** A kept look's id: 96 random bits, so its address is not guessed. */
export const KEPT = /^k_[0-9a-f]{24}$/;

const INDEX = 'keptlook:index';
const keyOf = (id: string) => `keptlook:${id}`;
const take = (ctx: KernelContext, key: string) => ctx.call('root.transient', { take: key });

/** Where the app's page loads a kept look's picture: on this server, by its workspace and id. */
export const keptUrl = (workspace: string, id: string) => `/look/${encodeURIComponent(workspace)}/${id}`;

/** Keep a look's picture and what was said of it: answers its id and address. The oldest past KEPT_MOST is taken away. */
export async function keepLook<T>(ctx: KernelContext, value: T, data: Buffer): Promise<{ id: string; url: string }> {
  const id = `k_${randomBytes(12).toString('hex')}`;
  await keep(ctx, keyOf(id), value, KEPT_MS, data);
  // Two keeps at once may each read the index before the other writes it: one id then drops out of it, and its look
  // lapses at KEPT_MS rather than being taken at once. The bound holds either way.
  const all = [...((await kept<string[]>(ctx, INDEX)) ?? []), id];
  const gone = all.splice(0, Math.max(0, all.length - KEPT_MOST));
  for (const old of gone) await take(ctx, keyOf(old));
  await keep(ctx, INDEX, all, KEPT_MS);
  return { id, url: keptUrl(ctx.workspace, id) };
}

/** A kept look, with its bytes, or nothing for an id that is none or was not kept here. */
export const keptLook = <T>(ctx: KernelContext, id: string) => (KEPT.test(id) ? keptWith<T>(ctx, keyOf(id)) : Promise.resolve(undefined));

/** surface.kept_look: a kept look's picture, for the address keptUrl names; nothing for one not kept here. */
export async function keptPicture(ctx: KernelContext, id: string): Promise<{ data: Buffer; content_type: string } | undefined> {
  const got = await keptLook<{ content_type?: string }>(ctx, id);
  return got?.data ? { data: got.data, content_type: got.value.content_type === 'image/jpeg' ? 'image/jpeg' : 'image/png' } : undefined;
}
