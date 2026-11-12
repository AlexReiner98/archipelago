// The slots a root opens for the whole server rather than for a workspace (docs/kernel-packs.md, "Slots"), filled once
// when the server starts, from the internal packs in the server's own folder: a workspace's fillings are read at its
// open (kernel-context.ts, openKernel), these before any is open. A filling is named in its pack's manifest under
// `kernel.hooks`, as any other, and is handed a context of its pack's server duty (serverContext): no map.
//
// Identity's identity.invited: who tells members' notices (an invitation, a sign-in code). The mailer pack fills it.
// Loaded by the surface's server start (first-start.ts, server-acts.ts): its top-level await fills the slots before
// the server answers anything.

import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { onMemberNotice, type MemberNotices } from '../../identity/kernel/members.ts';
import { isInternal, type Manifest } from './manifest.ts';
import { OWN_PACKS } from './pack-folders.ts';
import { ownManifest } from './root-calls.ts';
import { serverContext } from './kernel-context.ts';

/** The server's slots, each with what is done with its one filling. */
const SLOTS: Record<string, (filled: unknown) => void> = {
  'identity.invited': (filled) => onMemberNotice(filled as MemberNotices),
};

/** No workspace is handed a server slot's filling: it is filled before any opens. */
const none = new Proxy({}, { get: () => { throw new Error('A server slot\'s filling is handed no workspace'); } }) as Parameters<typeof serverContext>[1];

/** Fill each server slot from the one internal pack in the server's own folder that names it; two that do stop the start. */
export async function fillServerSlots(home = OWN_PACKS): Promise<void> {
  const packs = readdirSync(home).sort().flatMap((id) => {
    const m = ownManifest(id, join(home, '..')) as Manifest | undefined;
    return m && isInternal(m) && m.kernel?.trust === 'service' ? [m] : [];
  });
  for (const [point, fill] of Object.entries(SLOTS)) {
    const by = packs.filter((m) => m.kernel?.hooks?.[point] !== undefined);
    if (by.length > 1) throw new Error(`${point} is filled by ${by.map((m) => m.id).join(' and ')}: a server slot takes one filling`);
    const pack = by[0];
    if (!pack) continue;
    const ref = [pack.kernel!.hooks![point]].flat()[0];
    const [file, name] = ref.split('#');
    if (!file || file.includes('..')) throw new Error(`The ${pack.id} pack fills ${point} with ${ref}, outside its modules`);
    const dir = resolve(home, pack.id, pack.kernel?.modules ?? 'kernel/');
    const f = ((await import(pathToFileURL(resolve(dir, file)).href)) as Record<string, unknown>)[name];
    if (typeof f !== 'function') throw new Error(`The ${pack.id} pack fills ${point} with ${ref}, which is no function of its modules`);
    fill(await f(serverContext(pack.id, none)));
  }
}

await fillServerSlots();
