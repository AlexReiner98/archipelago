// A drawing's code as files, at addresses its content names: GET /drawing/<hash>/<module>.js answers one module of the
// drawing with that hash (packs/loader/kernel/layouts.ts, the same hash a style's `drawing.hash` carries), its text exactly what the
// page posts to the frame, so its `./name.js` imports resolve beside it. A worker that cannot import() a blob (a service
// worker) imports these statically. The drawings are those the packs ship, and the owner's versions of them kept on the
// map (core's layout type, a preset naming the drawing), read as the person asking sees them: the database decides
// which they may (row level security), and the read is bounded by the drawings' ids. What the packs ship and the
// versions on the map are the surface root's to read (root.drawing).

import type { KernelContext } from '#pelago/kernel';

const HASH = /^[0-9a-f]{64}$/;
const NAME = /^[a-z][a-z0-9_-]*\.js$/;

/** Whether a path is one this route answers: /drawing/<hash>/<module>.js. */
export const drawingPath = (path: string): { hash: string; name: string } | undefined => {
  const [, first, hash = '', name = '', extra] = path.split('/');
  return first === 'drawing' && extra === undefined && HASH.test(hash) && NAME.test(name) ? { hash, name } : undefined;
};

/**
 * The service worker of the drawing with this hash (GET /drawing/<hash>/sw.js), in its scope beside its modules: what
 * runs in a drawing's worker (packs/walls/page/draw-inside.js) around its index.js, imported statically. Only for a drawing whose
 * code is a pack's own: the frame cannot stop a service worker, so code kept on the map never runs in one
 * (./published-frames.ts keeps the same rule), and the frame draws such a drawing in a worker it can stop. Null else.
 */
export async function drawingWorker(ctx: Pick<KernelContext, 'call'>, hash: string): Promise<string | null> {
  if (!HASH.test(hash)) return null;
  return ctx.call<unknown, string | null>('root.drawing', { hash, worker: true });
}

/** Whether the drawing with this hash is a pack's own: read from what the packs ship, never from the map. */
export const shippedDrawing = async (ctx: Pick<KernelContext, 'call'>, hash: string) => HASH.test(hash) && (await ctx.call<unknown, boolean>('root.drawing', { hash })) === true;

/** The text of one module of the drawing with this hash, as this map shows it to its reader; null if there is none. */
export async function drawingFile(ctx: Pick<KernelContext, 'call'>, hash: string, name: string): Promise<string | null> {
  if (!HASH.test(hash) || !NAME.test(name)) return null;
  return ctx.call<unknown, string | null>('root.drawing', { hash, file: name });
}
