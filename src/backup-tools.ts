// The whole map as a file, for its owner to keep or to rehearse a change on. A backup holds everything, private
// items included, so an agent is given one only when the owner has said agents may (core's rule agent_backups, which the owner lifts on Workspace).
// The file is not put in an answer: the answer is a link that gives it once, within minutes, to be saved to disk.

import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { dump, localPackOf } from './backup.ts';
import { dumpVault, rewrap } from './vault.ts';
import type { Q } from './db.ts';
import { wholeMap } from './outbox.ts';
import { actorId, type Actor } from './pelago.ts';
import { mayDo } from './rules.ts';
import type { Tool } from './tools.ts';
import { keep, take } from './transient.ts';

const LINK_MINUTES = 5;
// The file waits in the workspace's database, not in this process: the link works from whichever server answers it.
const linkKey = (key: string) => `backup:${key}`;

/** The file a link was made for, given once: nothing for a link that is unknown, used or run out. `db` is the whole workspace's. */
export async function takeBackup(db: Q, key: string): Promise<{ file: Buffer; name: string } | undefined> {
  const found = await take<{ name: string }>(db, linkKey(key));
  return found?.data && { file: found.data, name: found.value.name };
}

/** Send the file a link was made for, or say it is gone. */
export async function serveBackupFile(db: Q | undefined, key: string, res: ServerResponse): Promise<void> {
  const found = db && (await takeBackup(db, key));
  if (!found) {
    res.writeHead(404, { 'content-type': 'application/json' });
    return void res.end(JSON.stringify({ error: 'This link has been used or has run out: ask for the backup again.' }));
  }
  res.writeHead(200, { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${found.name}"`, 'content-length': found.file.length, 'cache-control': 'no-store' });
  res.end(found.file);
}

/**
 * Whether an actor is an admin, or an agent acting for one: everything is in a backup, so an agent a member who is no
 * admin made is refused it (the sweep of 29 Oct 2026). Its person is an admin when they are a member who is one, or
 * hold a live admin sign-in. An agent tied to nobody passes only on a server with no tokens: with them, a token tied to
 * nobody need not be an admin's, nor the agent it made.
 */
async function actsForAdmin(db: Q, actor: Actor): Promise<boolean> {
  if (actor.kind === 'human') return Boolean(actor.admin);
  if (actor.may && actor.may !== 'change') return false;
  if (!actor.person) return !actor.token;
  const { rows } = await db.query(
    `select 1 from member where person_id = $1 and admin and removed_at is null
     union all select 1 from token where entity_id = $1 and kind = 'human' and admin and revoked_at is null and (expires_at is null or expires_at > now()) limit 1`,
    [actor.person],
  );
  return rows.length > 0;
}

export const BACKUP_TOOLS: Record<string, Tool> = {
  backup_download: {
    description:
      'This workspace as a backup file (.json.gz), as it stands now: answers with a path on this server that gives the file once, within five minutes, with no token (GET it and save it; do not read it into the conversation). ' +
      'Its rows are sealed: vault_path gives the keys the same way, wrapped under vault_key, which only this answer holds. ' +
      'Everything is in it, private items included, so an agent may call this only when the owner allows it on the Workspace page. To rehearse a change on it: node src/backup.ts restore <file> <new data folder>, then a throwaway server on that folder.',
    input: {},
    run: async (l, actor) => {
      const whole = await wholeMap(l);
      if (!(await actsForAdmin(whole.db, actor))) throw new Error('Only a workspace admin can download its backup.');
      await mayDo(l.db, l.registry, actor.kind === 'human', 'backup_download');
      const taken = await dump(whole.db, { id: l.workspace, name: l.workspace }, localPackOf(whole.registry));
      const key = randomBytes(24).toString('base64url');
      const name = `archipelago-${l.workspace}-${taken.taken.replaceAll(':', '-')}.json.gz`;
      const file = gzipSync(JSON.stringify(taken));
      await keep(whole.db, linkKey(key), { name }, LINK_MINUTES * 60_000, file);
      // Its rows are sealed: the keys come beside it, wrapped under a key given only here. A copy saved off the server
      // is out of a forget's reach, as any copy is (e_98ddd7ha).
      const [vault, transport] = [randomBytes(24).toString('base64url'), randomBytes(32)];
      await keep(whole.db, linkKey(vault), { name: name.replace('.json.gz', '.vault.json.gz') }, LINK_MINUTES * 60_000, gzipSync(JSON.stringify(rewrap(await dumpVault(whole.db), undefined, transport))));
      await l.log(l.db, { actor: actorId(actor), action: 'workspace.backup_download', reason: `Backup of the whole workspace downloaded (${Math.round(file.length / 1024)} KB)` });
      await l.record('access', actorId(actor), [['+', actorId(actor), 'backup_download', { bytes: file.length, taken: taken.taken }]]);
      return { path: `/backup-file/${l.workspace}/${key}`, vault_path: `/backup-file/${l.workspace}/${vault}`, vault_key: transport.toString('base64url'), name, bytes: file.length, taken: taken.taken, rows: Object.values(taken.tables).reduce((n, rows) => n + rows.length, 0), expires_in_minutes: LINK_MINUTES };
    },
  },
};
