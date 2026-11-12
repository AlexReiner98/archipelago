// The surface root's services for the publish pack (docs/kernel-packs.md, "Root services"), called only by the packs
// packs/roots.json names: a drawing's code as files (root.drawing), and what a product's public page is made of
// (root.public_product). Values in, values out.

import type { RootCall } from '../../../src/root-calls.ts';
import type { Registry } from '../../loader/kernel/packs.ts';
import { drawingsBy, layoutsOf } from '../../loader/kernel/layouts.ts';
import { GUARD, POLICY } from '../../walls/kernel/public-document.ts';
import { publicPage, publicPicture } from '../../walls/kernel/public.ts';
import { drawInside, uiPage } from './ui-files.ts';

const HASH = /^[0-9a-f]{64}$/;
const NAME = /^[a-z][a-z0-9_-]*\.js$/;
/** How many versions of the packs' drawings are read at most: a few per drawing, on any map. */
const VERSIONS = 200;

/** The drawings the packs ship, by hash, per registry: they change only when the packs do. */
const shipped = new WeakMap<object, Map<string, Record<string, string>>>();
function shippedBy(registry: Registry): Map<string, Record<string, string>> {
  if (!shipped.has(registry)) shipped.set(registry, drawingsBy(registry));
  return shipped.get(registry)!;
}

/**
 * root.drawing: of the drawing with this hash, as this map shows it to its reader, one module's text (file), its service
 * worker (worker: a pack's own drawing's alone, since the frame cannot stop a service worker), or with neither whether
 * it is a pack's own (read from what the packs ship, never from the map). Null when there is none.
 */
export async function drawing(call: RootCall, input: { hash: string; file?: string; worker?: boolean }): Promise<string | boolean | null> {
  const l = call.map;
  if (!l) throw new Error('root.drawing reads a map: a server duty has none');
  const hash = String(input?.hash);
  const registry = l.registry;
  if (input.file === undefined && !input.worker) return HASH.test(hash) && shippedBy(registry).has(hash);
  if (input.worker) {
    if (!HASH.test(hash) || !shippedBy(registry).get(hash)?.['index.js']) return null;
    return `import * as made from './index.js';\n${await drawInside()}\ninside(null, made);\n`;
  }
  const name = String(input.file);
  if (!HASH.test(hash) || !NAME.test(name)) return null;
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

/**
 * root.public_product: what a product's public page at /p/<workspace>/<id> is made of, read as the public role sees the
 * map: the headers every public answer carries (guard, and policy for the page), and the page with whether there is
 * anything public by that id (no what), its data (data), or one of its results' pictures (picture, extra the result).
 * With no map (a workspace the server does not hold) there is nothing public to find.
 */
export async function publicProduct(call: RootCall, input: { id: string; what?: string; extra?: string; build?: string }) {
  const l = call.map;
  const id = String(input?.id);
  const guard = { ...GUARD };
  if (!input.what) {
    const found = Boolean(l) && (await l!.forAnyone().db.query(`select 1 from entity where id = $1`, [id])).rows.length > 0;
    return { guard, policy: POLICY, found, html: await uiPage('public.html') };
  }
  if (input.what === 'data') return { guard, page: l ? await publicPage(l, id, input.build) : null };
  if (input.what === 'picture') {
    const picture = l && input.extra ? await publicPicture(l, String(input.extra)) : null;
    return { guard, picture: picture ? { content_type: picture.content_type, data: picture.bytes.toString('base64') } : null };
  }
  return { guard };
}
