// How a pack's read (src/packreads.ts) gives an item back, and how it pages: shared by every read that answers rows.
// An item comes with what it is (is: its type and those it extends); a read that asks for some fields is given those
// of its props and no note. A read past one page is given a cursor (next) to ask for the rest with, opaque to the asker.

import type { Archipelago } from '../../write/kernel/pelago.ts';

/** The most rows one read, or one page of a read, gives back. */
export const READ_LIMIT = 500;
export const NAME = /^[a-z][a-z0-9_]*$/;

/** A page of a read: where to start (the next a page before gave) and how many rows, READ_LIMIT at most. */
export type Page = { after?: string; size?: number };

/** One page of rows, and the cursor for the next when there are more. */
export type Paged<T> = { rows: T[]; next?: string };

/** The columns of an item as the asker may read them, and how a row is handed back. Anyone with no login reads no
 *  note, no owner, no link's id, and of the props only the few public ones. */
export function shapes(l: Archipelago, fields?: string[]) {
  const open = l.props === 'props';
  const cols = (e: string) =>
    `${e}.id, ${e}.type, ${e}.title, ${e}.status, ${open ? `${e}.owner` : 'null as owner'}, ${e}.is_open, ${e}.visibility, ${e}.created_at, ${e}.updated_at, ${e}.archived_at, ${open ? `${e}.props, ${e}.body` : `pelago_public_props(${e}.id) as props`}`;
  const typed = <T extends { type: string; props?: Record<string, unknown>; body?: string }>(e: T) => {
    const { body, props, ...rest } = e;
    const kept = fields ? { props: Object.fromEntries(fields.filter((f) => props?.[f] !== undefined).map((f) => [f, props![f]])) } : { ...(props !== undefined && { props }), ...(body !== undefined && { body }) };
    return { ...rest, ...kept, is: l.registry.type(e.type)?.lineage ?? [e.type] };
  };
  const family = (types: string[] | undefined) => (types?.length ? types.flatMap((t) => l.registry.family(t)) : null);
  return { open, cols, typed, family };
}

/** A page as asked, checked: its size, and the place it starts after as the read's key (a sort value and an id). */
export function pageOf(page: Page | undefined): { size: number; after: [string, string] | null } | null {
  if (page === undefined) return null;
  if (typeof page !== 'object' || page === null) throw new Error('page is { after?, size? }');
  const size = page.size === undefined ? READ_LIMIT : Number(page.size);
  if (!Number.isInteger(size) || size < 1 || size > READ_LIMIT) throw new Error(`page.size is a whole number from 1 to ${READ_LIMIT}`);
  if (page.after === undefined) return { size, after: null };
  try {
    const key = JSON.parse(Buffer.from(String(page.after), 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(key) && key.length === 2 && key.every((k) => typeof k === 'string')) return { size, after: key as [string, string] };
  } catch {
    // Said below.
  }
  throw new Error('page.after is the next a page before gave, as it gave it');
}

/** Rows read one past the page (each with its key as `page_key` and `page_id`), cut to the page, with the cursor for the next. */
export function paged<R extends { page_key: unknown; page_id: string }, T>(rows: R[], size: number, shape: (row: Omit<R, 'page_key' | 'page_id'>) => T): Paged<T> {
  const more = rows.length > size;
  const kept = rows.slice(0, size);
  const last = kept[kept.length - 1];
  return {
    rows: kept.map(({ page_key: _k, page_id: _i, ...row }) => shape(row)),
    ...(more && last && { next: Buffer.from(JSON.stringify([String(last.page_key), last.page_id])).toString('base64url') }),
  };
}
