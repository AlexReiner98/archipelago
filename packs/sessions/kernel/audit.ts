// A connection's own log of the tools it called, copied into the event log. What is written is the write path's, asked
// through root.bookkeep: the entries and how far the log was read, in one transaction, as they were before the move.

import { existsSync, readFileSync } from 'node:fs';
import type { KernelContext } from '#pelago/kernel';
import { recordAs } from './bookkeeping.ts';
import { actorId, type Actor, type Item } from './types.ts';

/** One entry as the activity keeps it (packs/log/kernel/activity.ts, Done). */
type Done = { actor: string; action: string; target: string; origin: string; ts: string; detail: Record<string, unknown> };

/**
 * Copy new entries from a connection's JSON-lines tool-call log into the
 * event log. Expects lines shaped {ts, tool, params, durationMs, ok, error}.
 */
export async function importAudit(ctx: KernelContext, actor: Actor, input: { connection: string }) {
  const [conn] = (await ctx.reads({ ids: [input.connection] })) as Item[];
  if (!conn || !ctx.registry.isA(conn.type, 'connection')) throw new Error(`"${input.connection}" is not a connection`);
  const path = conn.props.audit_log as string | undefined;
  if (!path) throw new Error(`"${conn.title}" has no audit_log path`);
  if (!existsSync(path)) return { imported: 0, path, note: 'Log file does not exist yet.' };

  const cursorKey = `audit_cursor:${conn.id}`;
  const cursor = ((await ctx.call('root.bookkeep', { audit_cursor: cursorKey })) as string | null) ?? '';
  let latest = cursor;
  let skipped = 0;
  const entries: Done[] = [];
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
    entries.push({
      actor: `external:${conn.title}`,
      action: entry.tool,
      target: conn.id,
      origin: 'external',
      ts: entry.ts,
      detail: { params: entry.params, durationMs: entry.durationMs, ok: entry.ok, error: entry.error },
    });
    if (entry.ts > latest) latest = entry.ts;
  }
  await ctx.call('root.bookkeep', { audit: { entries, cursor: { key: cursorKey, value: latest } } });
  const imported = entries.length;
  if (imported) await recordAs(ctx, 'observations', actorId(actor), [['+', conn.id, 'imported', { imported, path }]]), await recordAs(ctx, 'automations', actorId(actor), [['+', conn.id, 'audit_cursor', latest]]);
  return { imported, skipped, path };
}
