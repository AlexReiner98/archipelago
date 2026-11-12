// The rows the pack's reads give back (src/packreads.ts, src/packreads-kernel.ts): an item with every column the asker
// may read, a link as the map keeps it, and what the pack does with them that SQL did before (a field as text, one
// value holding another).
import type { KernelContext } from '#pelago/kernel';

/** An item as the read ids gives it. */
export interface Item {
  id: string;
  type: string;
  title: string;
  status: string;
  owner: string | null;
  is_open: boolean;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  props: Record<string, unknown>;
  body?: string;
}

/** An open link as the read links gives it. */
export interface Link {
  id: string;
  type: string;
  from_id: string;
  to_id: string;
  props: Record<string, unknown>;
}

/** Some items by id, as the asker may read them: those they may not, or that are not, are left out. */
export const byId = async (ctx: KernelContext, ids: string[]): Promise<Map<string, Item>> =>
  new Map(ids.length ? ((await ctx.reads({ ids })) as Item[]).map((e) => [e.id, e]) : []);

/** A field as the database says it as text (`props->>'due'`): a string as it is, anything else as its JSON. */
export const asText = (v: unknown): string | null => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));

/** Whether one JSON value holds another, as the database's `@>` does: an object every field, a list every element. */
export function contains(a: unknown, b: unknown): boolean {
  if (Array.isArray(b)) return Array.isArray(a) && b.every((x) => a.some((y) => contains(y, x)));
  if (b && typeof b === 'object') return !!a && typeof a === 'object' && !Array.isArray(a) && Object.entries(b).every(([k, v]) => k in a && contains((a as Record<string, unknown>)[k], v));
  return a === b;
}
