// The mentions pack's projector (log.project, docs/kernel-packs.md): for each item whose note or fields an entry
// wrote, the ids they hold are read again, and its rows of `mention` (from the item, to each item it names) replaced.
// Every read of the table joins it to entity, whose row-level security keeps out what may not be seen. A forgotten
// item's rows go by the write path itself, as every declared table's do.
import type { KernelContext } from '#pelago/kernel';

type Fact = [op: '+' | '-', id: string, field: string, value?: unknown];
type Item = { id: string; body: string; props: Record<string, unknown> };
export interface Rows {
  item(id: string): Promise<Item | undefined>;
  replace(table: string, column: string, id: string, rows: Record<string, unknown>[]): Promise<void>;
}

/** An item's id as it is written in a note: e_ and eight letters or digits, a word of its own. */
const ID = /(?<!\w)e_[a-z0-9]{8}(?!\w)/g;

/** The fields of an item that name nothing: its head, and what the log says beside its fields (docs/log.md). */
const NAMES_NOTHING = new Set(['type', 'title', 'status', 'visibility', 'private_to', 'owner', 'confidence', 'source', 'archived', 'checked', 'merged_into', 'forgotten']);

/** The ids a note and fields name, the item's own left out. */
export function named(item: Item): string[] {
  const text = `${item.body ?? ''} ${JSON.stringify(item.props ?? {})}`;
  return [...new Set(text.match(ID) ?? [])].filter((id) => id !== item.id);
}

/** The items whose note or fields these facts wrote, in the order they were said: never a link (r_…), never one forgotten. */
export function written(facts: Fact[]): string[] {
  const gone = new Set(facts.filter((f) => f[0] === '+' && f[2] === 'forgotten').map((f) => f[1]));
  return [...new Set(facts.filter((f) => f[1].startsWith('e_') && !gone.has(f[1]) && !NAMES_NOTHING.has(f[2])).map((f) => f[1]))];
}

/** log.project: what each written item names, read again from it. */
export async function project(_ctx: KernelContext, facts: Fact[], rows: Rows): Promise<void> {
  for (const id of written(facts)) {
    const item = await rows.item(id);
    if (!item) continue; // a fact on what is not an item
    await rows.replace('mention', 'from_id', id, named(item).map((to) => ({ from_id: id, to_id: to })));
  }
}
