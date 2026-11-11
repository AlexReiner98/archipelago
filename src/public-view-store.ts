// Where public views are kept and read (src/public-schema.ts, PUBLIC_VIEW): written when a person shares a view or an
// item, or publishes a document (src/public-view.ts, src/published.ts); read by anyone through the database's narrow
// functions alone, so a reader is given the frozen copy and nothing of the map as it is now.

import type { Q } from './db.ts';
import { layoutFor } from './layouts.ts';
import type { Archipelago } from './pelago.ts';

const ID = /^e_[a-z0-9]{8}$/;
/** An address word: lowercase letters and digits, words joined by single dashes. */
const PATH = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Given = { path?: string | null; menu?: number | null } & Record<string, unknown>;

/** Keep what is given as the public view of `id`, in place of any before it. Its path and place are the given's own. */
export async function keepPublicView(tx: Q, workspace: string, id: string, given: Given, by: string) {
  await tx.query(
    `insert into public_view (entity_id, workspace, given, shared_by, path, menu) values ($1, $2, $3::jsonb, $4, $5, $6)
     on conflict (entity_id) do update set given = excluded.given, shared_by = excluded.shared_by, path = excluded.path, menu = excluded.menu, shared_at = now()`,
    [id, workspace, JSON.stringify(given), by, given.path ?? null, given.menu ?? null],
  );
}

type Frozen = { style?: Record<string, unknown> };

/**
 * Each picture with a drawing: its own, or the pack's for its shape, or the flow's, as the page drew a picture frozen
 * before its shape had one. A page frozen since keeps the drawing it was frozen with.
 */
export function drawingsGiven<T extends Frozen>(l: Pick<Archipelago, 'registry'>, lenses: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(lenses).map(([id, frozen]) => {
      const style = frozen.style ?? {};
      if (style.drawing) return [id, frozen];
      const drawing = layoutFor(l.registry, { shape: style.shape }, []);
      return [id, drawing ? { ...frozen, style: { ...style, shape: drawing.shape, drawing } } : frozen];
    }),
  );
}

const withDrawings = (l: Archipelago, doc: Record<string, unknown> | null) => (doc?.lenses ? { ...doc, lenses: drawingsGiven(l, doc.lenses as Record<string, Frozen>) } : doc);

/** The public view of an item, as anyone reads it, or null. */
export async function publicView(l: Archipelago, id: string) {
  if (!ID.test(id)) return null;
  const { rows } = await l.forAnyone().db.query<{ doc: Record<string, unknown> | null }>(`select pelago_public_view($1) as doc`, [id]);
  return withDrawings(l, rows[0]?.doc ?? null);
}

/** The public view at an address word, as anyone reads it, or null. */
export async function publicViewAt(l: Archipelago, path: string) {
  if (!PATH.test(path)) return null;
  const { rows } = await l.forAnyone().db.query<{ doc: Record<string, unknown> | null }>(`select pelago_public_view_at($1) as doc`, [path]);
  return withDrawings(l, rows[0]?.doc ?? null);
}

/** Every public view, for a site's header and its sitemap: id, title as shared, path, place and when. */
export async function publicViews(l: Archipelago): Promise<{ id: string; title: string; path: string | null; menu: number | null; published_at: string }[]> {
  const { rows } = await l.forAnyone().db.query<{ views: never[] }>(`select pelago_public_views() as views`);
  return rows[0]?.views ?? [];
}

/** The figure of one section a public view holds, or null. */
export async function publicViewPicture(l: Archipelago, id: string, section: string): Promise<{ content_type: string; bytes: Buffer } | null> {
  if (!ID.test(id) || !ID.test(section)) return null;
  const { rows } = await l.forAnyone().db.query<{ content_type: string; data: string }>(`select content_type, encode(bytes, 'base64') as data from pelago_public_view_picture($1, $2)`, [id, section]);
  return rows[0] ? { content_type: rows[0].content_type, bytes: Buffer.from(rows[0].data, 'base64') } : null;
}
