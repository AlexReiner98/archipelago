// Moved to packs/views/kernel/documents.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What read the map is handed the views pack's context of it,
// made when it is called (kernelContext); what reads only a type's fields takes anything with the registry, the map too.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/views/kernel/documents.ts';

export * from '../packs/views/kernel/documents.ts';

/** The views pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'views');

export const readDocument = async (l: Archipelago, id: string) => moved.readDocument(await ctx(l), id);
