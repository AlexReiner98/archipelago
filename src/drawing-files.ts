// A drawing's code as files, at addresses its content names: GET /drawing/<hash>/<module>.js answers one module of the
// drawing with that hash (src/layouts.ts, the same hash a style's `drawing.hash` carries), its text exactly what the
// page posts to the frame, so its `./name.js` imports resolve beside it. A worker that cannot import() a blob (a service
// worker) imports these statically. The drawings are those the packs ship, and the owner's versions of them kept on the
// map (core's layout type, a preset naming the drawing), read as the person asking sees them: the database decides
// which they may (row level security), and the read is bounded by the drawings' ids.

import type { Archipelago } from './pelago.ts';
import { drawingsBy, layoutsOf } from './layouts.ts';
import { drawInside } from './ui-files.ts';

const HASH = /^[0-9a-f]{64}$/;
const NAME = /^[a-z][a-z0-9_-]*\.js$/;
/** How many versions of the packs' drawings are read at most: a few per drawing, on any map. */
const VERSIONS = 200;

/** The drawings the packs ship, by hash, per registry: they change only when the packs do. */
const shipped = new WeakMap<object, Map<string, Record<string, string>>>();

/** Whether a path is one this route answers: /drawing/<hash>/<module>.js. */
export const drawingPath = (path: string): { hash: string; name: string } | undefined => {
  const [, first, hash = '', name = '', extra] = path.split('/');
  return first === 'drawing' && extra === undefined && HASH.test(hash) && NAME.test(name) ? { hash, name } : undefined;
};

/** The drawings the packs ship, by hash: the same for every map with these packs. */
function shippedBy(registry: Archipelago['registry']): Map<string, Record<string, string>> {
  if (!shipped.has(registry)) shipped.set(registry, drawingsBy(registry));
  return shipped.get(registry)!;
}

/**
 * The service worker of the drawing with this hash (GET /drawing/<hash>/sw.js), in its scope beside its modules: what
 * runs in a drawing's worker (ui/draw-inside.js) around its index.js, imported statically. Only for a drawing whose
 * code is a pack's own: the frame cannot stop a service worker, so code kept on the map never runs in one
 * (src/published-frames.ts keeps the same rule), and the frame draws such a drawing in a worker it can stop. Null else.
 */
export async function drawingWorker(l: Archipelago, hash: string): Promise<string | null> {
  if (!HASH.test(hash) || !shippedBy(l.registry).get(hash)?.['index.js']) return null;
  return `import * as made from './index.js';\n${await drawInside()}\ninside(null, made);\n`;
}

/** Whether the drawing with this hash is a pack's own: read from what the packs ship, never from the map. */
export const shippedDrawing = (l: Archipelago, hash: string) => HASH.test(hash) && shippedBy(l.registry).has(hash);

/** The text of one module of the drawing with this hash, as this map shows it to its reader; null if there is none. */
export async function drawingFile(l: Archipelago, hash: string, name: string): Promise<string | null> {
  if (!HASH.test(hash) || !NAME.test(name)) return null;
  const registry = l.registry;
  const own = shippedBy(registry).get(hash);
  if (own) return Object.hasOwn(own, name) ? own[name] : null;
  // Else one the owner changed: their versions of the packs' drawings, as the reader may see them.
  const ids = layoutsOf(registry.packs).map((d) => d.id);
  if (!ids.length) return null;
  // The fields as this reader may read them: a member its own column, anyone with no login only what is public of it.
  const fields = l.props.replace(/\s+as props$/, '');
  const { rows } = await l.db.query<{ is_open: boolean; props: Record<string, unknown> }>(
    `select is_open, ${fields} as props from entity where type = any($1::text[]) and archived_at is null and (${fields}) ->> 'preset' = any($2::text[]) order by updated_at, id limit ${VERSIONS}`,
    [registry.family('layout'), ids],
  );
  const modules = drawingsBy(registry, rows).get(hash);
  return modules && Object.hasOwn(modules, name) ? modules[name] : null;
}
