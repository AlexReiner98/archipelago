// A connection's own log of the tools it called, copied into the event log.

import { existsSync, readFileSync } from 'node:fs';
import { actorId, type Actor, type Archipelago } from './pelago.ts';

/**
 * Copy new entries from a connection's JSON-lines tool-call log into the
 * event log. Expects lines shaped {ts, tool, params, durationMs, ok, error}.
 */
export async function importAudit(l: Archipelago, actor: Actor, input: { connection: string }) {
  const conn = await l.entity(input.connection);
  if (!conn || !l.registry.isA(conn.type, 'sys.connection')) throw new Error(`"${input.connection}" is not a connection`);
  const path = conn.props.audit_log as string | undefined;
  if (!path) throw new Error(`"${conn.title}" has no audit_log path`);
  if (!existsSync(path)) return { imported: 0, path, note: 'Log file does not exist yet.' };

  const cursorKey = `audit_cursor:${conn.id}`;
  const cursor = (await l.setting<string>(cursorKey)) ?? '';
  let latest = cursor;
  let imported = 0;
  let skipped = 0;
  await l.db.transaction(async (tx) => {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let entry: { ts?: string; tool?: string; params?: unknown; durationMs?: number; ok?: boolean; error?: unknown };
      try {
        entry = JSON.parse(line);
      } catch {
        skipped++;
        continue;
      }
      if (!entry.ts || !entry.tool || Number.isNaN(Date.parse(entry.ts))) {
        skipped++;
        continue;
      }
      if (entry.ts <= cursor) continue;
      await l.log(tx, {
        actor: `external:${conn.title}`,
        action: entry.tool,
        target: conn.id,
        origin: 'external',
        ts: entry.ts,
        detail: { params: entry.params, durationMs: entry.durationMs, ok: entry.ok, error: entry.error },
      });
      if (entry.ts > latest) latest = entry.ts;
      imported++;
    }
    await tx.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [
      cursorKey,
      JSON.stringify(latest),
    ]);
  });
  if (imported) await l.log(l.db, { actor: actorId(actor), action: 'audit.import', target: conn.id, detail: { imported, path } });
  return { imported, skipped, path };
}
