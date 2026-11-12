// Moved to packs/publish/kernel/drawing-files.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the publish pack's context of it,
// made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/publish/kernel/drawing-files.ts';

export * from '../packs/publish/kernel/drawing-files.ts';

/** The publish pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'publish');

type Rest<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;

export const drawingWorker = async (l: Archipelago, ...rest: Rest<typeof moved.drawingWorker>) => moved.drawingWorker(await ctx(l), ...rest);
export const shippedDrawing = async (l: Archipelago, ...rest: Rest<typeof moved.shippedDrawing>) => moved.shippedDrawing(await ctx(l), ...rest);
export const drawingFile = async (l: Archipelago, ...rest: Rest<typeof moved.drawingFile>) => moved.drawingFile(await ctx(l), ...rest);
