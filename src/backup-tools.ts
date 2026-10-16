// The whole map as a file, for its owner to keep or to rehearse a change on. A backup holds everything, private
// items included, so an agent is given one only when the owner has said agents may (agent_backups, on Workspace).
// The file is not put in an answer: the answer is a link that gives it once, within minutes, to be saved to disk.

import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { dump, localPackOf } from './backup.ts';
import { wholeMap } from './outbox.ts';
import { actorId } from './pelago.ts';
import type { Tool } from './tools.ts';

const LINK_MINUTES = 5;
const ready = new Map<string, { file: Buffer; name: string; until: number }>();

/** The file a link was made for, given once: nothing for a link that is unknown, used or run out. */
export function takeBackup(key: string): { file: Buffer; name: string } | undefined {
  for (const [k, r] of ready) if (r.until < Date.now()) ready.delete(k);
  const found = ready.get(key);
  ready.delete(key);
  return found;
}

/** Send the file a link was made for, or say it is gone. */
export function serveBackupFile(key: string, res: ServerResponse): void {
  const found = takeBackup(key);
  if (!found) {
    res.writeHead(404, { 'content-type': 'application/json' });
    return void res.end(JSON.stringify({ error: 'This link has been used or has run out: ask for the backup again.' }));
  }
  res.writeHead(200, { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${found.name}"`, 'content-length': found.file.length, 'cache-control': 'no-store' });
  res.end(found.file);
}

export const BACKUP_TOOLS: Record<string, Tool> = {
  backup_download: {
    description:
      'This workspace as a backup file (.json.gz), as it stands now: answers with a path on this server that gives the file once, within five minutes, with no token (GET it and save it; do not read it into the conversation). ' +
      'Everything is in it, private items included, so an agent may call this only when the owner allows it on the Workspace page. To rehearse a change on it: node src/backup.ts restore <file> <new data folder>, then a throwaway server on that folder.',
    input: {},
    run: async (l, actor) => {
      if (actor.kind === 'human' && !actor.admin) throw new Error('Only a workspace admin can download its backup.');
      if (actor.kind !== 'human' && (await l.setting<boolean>('agent_backups')) !== true) throw new Error('Agents may not download this workspace’s backups: the owner allows it on the Workspace page, under Backups.');
      const whole = await wholeMap(l);
      const taken = await dump(whole.db, { id: l.workspace, name: l.workspace }, localPackOf(whole.registry));
      const key = randomBytes(24).toString('base64url');
      const name = `archipelago-${l.workspace}-${taken.taken.replaceAll(':', '-')}.json.gz`;
      const file = gzipSync(JSON.stringify(taken));
      ready.set(key, { file, name, until: Date.now() + LINK_MINUTES * 60_000 });
      await l.log(l.db, { actor: actorId(actor), action: 'workspace.backup_download', reason: `Backup of the whole workspace downloaded (${Math.round(file.length / 1024)} KB)` });
      return { path: `/backup-file/${key}`, name, bytes: file.length, taken: taken.taken, rows: Object.values(taken.tables).reduce((n, rows) => n + rows.length, 0), expires_in_minutes: LINK_MINUTES };
    },
  },
};
