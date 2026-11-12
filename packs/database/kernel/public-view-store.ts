// Where public views are kept (src/public-schema.ts, PUBLIC_VIEW): written when a person shares a view or an item, or
// publishes a document (src/public-view.ts, src/published.ts). They are read by anyone through the database's narrow
// functions alone (the surface's packs/surface/kernel/public-views.ts), so a reader is given the frozen copy and
// nothing of the map as it is now.

import type { Q } from './db.ts';

type Given = { path?: string | null; menu?: number | null } & Record<string, unknown>;

/** Keep what is given as the public view of `id`, in place of any before it. Its path and place are the given's own. */
export async function keepPublicView(tx: Q, workspace: string, id: string, given: Given, by: string) {
  await tx.query(
    `insert into public_view (entity_id, workspace, given, shared_by, path, menu) values ($1, $2, $3::jsonb, $4, $5, $6)
     on conflict (entity_id) do update set given = excluded.given, shared_by = excluded.shared_by, path = excluded.path, menu = excluded.menu, shared_at = now()`,
    [id, workspace, JSON.stringify(given), by, given.path ?? null, given.menu ?? null],
  );
}
