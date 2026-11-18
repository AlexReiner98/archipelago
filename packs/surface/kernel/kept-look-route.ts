// GET /look/<workspace>/<k_id>: a kept look's picture (packs/look_draw/kernel/kept.ts, surface.kept_look), for the
// app's page to load as an image. An <img> sends no token, so the address is the key, as a backup file's is
// (./backup-route.ts): its id is 96 random bits, handed only to one who could read the map, and it answers the picture
// alone. One of the surface's own routes answered before the server's (./surface-slots.ts).

import { onMap } from './above.ts';
import type { RouteFilling } from './surface-slots.ts';

export const keptLook: RouteFilling = {
  method: 'GET',
  path: /^\/look\/([a-z0-9_-]{1,64})\/(k_[0-9a-f]{24})$/,
  serve: async (_req, res, [, wsId, id], { workspaces, tooOften }) => {
    if (tooOften('open')) return; // a guessed id would otherwise be asked again and again
    const got = (await workspaces.has(wsId)) ? await onMap<{ data: Buffer; content_type: string } | undefined>((await workspaces.get(wsId)).pelago, 'surface.kept_look', id) : undefined;
    if (!got) return void res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('No such look is kept.');
    // A kept look never changes under its id: kept for good by whoever loaded it, and never sent on as a referrer.
    res.writeHead(200, { 'content-type': got.content_type, 'content-length': got.data.length, 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'", 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' });
    res.end(got.data);
  },
};
