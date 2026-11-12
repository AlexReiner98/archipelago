// GET /backup-file/<workspace>/<key>: a backup someone asked to download, by the one-time key its tool handed them
// (src/backup-tools.ts). Its filling of the slot surface.route (src/surface-slots.ts), held by the kernel until the
// backup pack takes it.

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
