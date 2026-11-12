// The usage pack's filling of the log's slot log.appended (docs/kernel-packs.md, "Slots"): each append's stored facts
// added to what is to be counted, through the log's function pelago_bytes_add (packs/log/kernel/bytes.ts holds the counts and their
// reads, which the usage view reads through root.counters).

import type { KernelContext } from '#pelago/kernel';

/** What the log's slot log.appended hands a filling: an append's facts as they were stored. */
export interface Appended { facts: unknown[] }
/** The writer the slot hands with it, inside the append's transaction: a function of the filling's own pack, by name. */
export interface AppendedRows { definer(name: string, arg: unknown): Promise<void> }

/** The filling of log.appended: an append's stored facts, added to what is to be counted. */
export async function appended(_ctx: KernelContext, entry: Appended, rows: AppendedRows): Promise<void> {
  if (entry.facts.length) await rows.definer('pelago_bytes_add', entry.facts);
}
