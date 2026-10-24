// The fact stream read back into rows of today's entity and relation tables: the first projection of the log, run
// without a database. Each fact sets one column or one declared field; the times come from the entries. The test
// replays a map's whole stream with it and compares the rows with the ones the write path wrote.

import type { Entry } from './log.ts';
import { ITEM_COLUMNS } from './facts.ts';

type Row = Record<string, any>;

/** Entries the system writes when a pack moves a type or its kind: the items did not change, so their time does not move. */
export const MOVED = ['type.moved', 'kind.moved'];

const COLUMN = new Map(ITEM_COLUMNS.map(([column, field, unsaid]) => [field, { column, unsaid }]));

/** Every item and link as the entries leave them, in order. isOpen says whether a status of a type is open. */
export function project(entries: Iterable<Entry>, isOpen: (type: string, status: string) => boolean) {
  const items = new Map<string, Row>();
  const links = new Map<string, Row>();
  for (const e of entries) {
    if (e.stream !== 'facts') continue;
    const at = e.at;
    const touched = new Set<string>();
    for (const fact of e.facts) {
      const [op, id, field] = fact;
      const value = op === '+' ? fact[3] : undefined;
      if (field === 'link' || links.has(id)) {
        let link = links.get(id);
        if (field === 'link') {
          if (op === '-') link!.valid_to = at;
          else {
            const [type, from, to] = value as [string, string, string];
            if (!link) links.set(id, (link = { id, props: {}, confidence: 1, source_id: null, valid_from: at }));
            Object.assign(link, { type, from_id: from, to_id: to, valid_to: null });
          }
        } else if (field === 'confidence') link!.confidence = op === '+' ? value : 1;
        else if (field === 'source') link!.source_id = op === '+' ? value : null;
        else if (op === '+') link!.props[field] = value;
        else delete link!.props[field];
        continue;
      }
      let item = items.get(id);
      if (!item) {
        if (field !== 'type') continue; // a type's definition (type_def) and other records are not items
        items.set(id, (item = { id, props: {}, created_at: at, archived_at: null, ...Object.fromEntries(ITEM_COLUMNS.map(([column, , unsaid]) => [column, unsaid ?? null])) }));
      }
      const head = COLUMN.get(field);
      if (head) item[head.column] = op === '+' ? value : head.unsaid;
      else if (field === 'archived') item.archived_at = op === '+' ? at : null;
      else if (field === 'checked' || field === 'merged_into' || field === 'forgotten') {
        // About the item, not a column of today's row: they move its time only.
      } else if (op === '+') item.props[field] = value;
      else delete item.props[field];
      if (!MOVED.includes(e.action as string) || item.created_at === at) item.updated_at = at;
      touched.add(id);
    }
    for (const id of touched) {
      const item = items.get(id)!;
      item.is_open = isOpen(item.type, item.status);
    }
  }
  return { items: [...items.values()], links: [...links.values()] };
}
