// The public views as anyone reads them (packs/database/kernel/public-schema.ts, PUBLIC_VIEW), kept by the database root
// (packs/database/kernel/public-view-store.ts, keepPublicView): read through the database's narrow functions alone, so
// a reader is given the frozen copy and nothing of the map as it is now. Each picture is given the drawing it is drawn
// by (the loader's layouts), and an item's public address is the one this server answers at (/p/<workspace>/<id>).

import { layoutFor } from '../../loader/kernel/layouts.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';

const ID = /^e_[a-z0-9]{8}$/;
/** An address word: lowercase letters and digits, words joined by single dashes. */
export const PATH = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Where a public item's page is read on this server: stable for as long as it is public, whatever it is renamed. */
export const publicPath = (workspace: string, id: string) => `/p/${workspace}/${id}`;

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

/**
 * The public views that show an item, itself or within (task e_r9e87vgz): each by title, when it was shared, and
 * whether the item has changed since (behind), so its page can offer to share that view again and an agent editing it
 * can tell the person. Read by the index on what a public view shows, never by reading every public view.
 */
export async function showingIn(l: Archipelago, id: string, updated: Date | string) {
  if (!ID.test(id)) return [];
  const { rows } = await l.db.query<{ id: string; title: string; shared_at: Date }>(
    `select v.entity_id as id, v.given ->> 'title' as title, v.shared_at from public_view v join entity e on e.id = v.entity_id
     where (v.entity_id = $1 or pelago_public_view_shows(v.given) @> jsonb_build_array($1::text)) and e.archived_at is null
     order by v.shared_at desc limit 50 -- index public_view_shows`,
    [id],
  );
  const changed = new Date(updated).getTime();
  return rows.map((r) => ({ ...r, address: publicPath(l.workspace, r.id), ...(changed > new Date(r.shared_at).getTime() && { behind: true }) }));
}
