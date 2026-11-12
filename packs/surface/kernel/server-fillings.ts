// The surface's slots for the whole server rather than a workspace (docs/kernel-packs.md, "Slots"): what the tool table
// and the MCP server are built with before any workspace opens, as the loader fills its own server slots
// (packs/loader/kernel/server-slots.ts). A filling is named in its pack's manifest under `kernel.hooks`, as any other.
//
// - `surface.tools`: tools a pack declares (./tool-input.ts, DeclaredTool), each run on the pack's context of the map
//   it is called on. Every internal pack of the server's own folder that fills it, in the order of their ids.
// - `surface.mcp`: what the MCP server speaks besides the tools (./mcp.ts): one pack's.

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isInternal, type Manifest } from '../../loader/kernel/manifest.ts';
import { OWN_PACKS } from '../../loader/kernel/pack-folders.ts';
import { ownManifest } from '../../loader/kernel/root-calls.ts';

/** A server slot's filling: its pack, and what its function answered. */
export interface ServerFilling<T> { pack: string; filled: T }

/** Each internal service pack of the server's own folder that fills `point`, in the order of their ids, with what its function answers. */
export async function serverFillings<T>(point: string, home = OWN_PACKS): Promise<ServerFilling<T>[]> {
  const out: ServerFilling<T>[] = [];
  for (const id of readdirSync(home).sort()) {
    const m = ownManifest(id, join(home, '..')) as Manifest | undefined;
    if (!m || !isInternal(m) || m.kernel?.trust !== 'service') continue;
    for (const ref of [m.kernel?.hooks?.[point] ?? []].flat()) {
      const [file, name] = ref.split('#');
      if (!file || file.includes('..')) throw new Error(`The ${id} pack fills ${point} with ${ref}, outside its modules`);
      const dir = resolve(home, id, m.kernel?.modules ?? 'kernel/');
      const f = ((await import(pathToFileURL(resolve(dir, file)).href)) as Record<string, unknown>)[name];
      if (typeof f !== 'function') throw new Error(`The ${id} pack fills ${point} with ${ref}, which is no function of its modules`);
      out.push({ pack: id, filled: (await f()) as T });
    }
  }
  return out;
}
