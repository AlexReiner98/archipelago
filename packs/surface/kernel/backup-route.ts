// GET /backup-file/<workspace>/<key>: a backup someone asked to download, by the one-time key its tool handed them
// (packs/surface/kernel/backup-tools.ts): one of the surface's own routes answered before the server's (packs/surface/kernel/surface-slots.ts), since the
// one-time keys are the surface's backup tools'.

import { serveBackupFile } from './backup-tools.ts';
import type { RouteFilling } from './surface-slots.ts';

export const backupFile: RouteFilling = {
  method: 'GET',
  path: /^\/backup-file\/([^/]*)(?:\/([^/]*))?/,
  serve: async (_req, res, [, wsId, key], { workspaces, tooOften }) => {
    if (tooOften('open')) return; // a guessed key would otherwise open the workspace it names, again and again
    return serveBackupFile(key && (await workspaces.has(wsId)) ? (await workspaces.get(wsId)).pelago.db : undefined, key ?? '', res);
  },
};
