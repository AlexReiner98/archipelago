// What a server pack may read of what a person published (task e_uc8m8jwa): a document as it was last published, the
// one at a site's path, its pictures and drawings, a site's pages. Each act goes through the security-definer reads
// alone (src/public-schema.ts), as anyone: the pack is handed only what is public, never the map. Publishing and taking
// down stay the kernel's (src/published.ts).
//
// A seam for now: the acts are declared (PUBLISHED_ACTS in src/server-packs.ts) and refused until they are built.

import type { ActPlaces } from './server-acts.ts';
import type { ServerAct, ServerPackFile } from './server-packs.ts';

export async function publishedAct(_at: ActPlaces, _pack: ServerPackFile, act: ServerAct, _input: Record<string, unknown>): Promise<unknown> {
  throw new Error(`The act "${act}" is not built yet.`);
}
