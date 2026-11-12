// What the surface's server holds of this pack for the whole process (surface.published, packs/surface/kernel/above.ts):
// the streams a published page listens on, a published document's data as a reader's page is given it, the counts a
// server pack keeps in memory until they are written down, and the sites the server serves. What reads a map is asked
// on that map (surface.public, surface.preview, surface.site_nav, surface.bake, surface.counts_since).

import type { KernelContext } from '#pelago/kernel';
import { addCount, COUNT_KEY, heldCounts, keepCounts } from './pack-counts.ts';
import { layoutCode, pageData } from './published-data.ts';
import { closePackListeners, listenForPack } from './published-live.ts';
import { readSites } from './site.ts';

export const served = (_ctx: KernelContext) => ({ listenForPack, closePackListeners, pageData, layoutCode, counts: { addCount, heldCounts, keepCounts, KEY: COUNT_KEY }, readSites });
