// Forgetting an item (docs/log.md, section 5): a change set that asserts it forgotten, and in the same transaction
// destroys its key and the keys of every link with it at either end (e_grqeftj2), puts each value they sealed in the
// log as its digest (e_k2aex62z), and takes what it said out of the stores beside the log. A held change that touches it
// loses its ops with it; a change set's reason and basis go only when the person forgetting chooses them, from those
// mentions() finds (e_4uzgmsry). The chain still verifies: it always hashed a sealed value by that same digest.
// Today's rows of the item leave in the write path (src/pelago.ts), through asOwner.

import type { Q } from './db.ts';
import { digested } from './seal.ts';
import { entries } from './log.ts';
import { destroy } from './vault.ts';

/** Forget an item, for good. `reasons`: change sets (c_…) and held changes (p_…) whose reason and basis go with it. */
export interface ForgetOp {
  op: 'forget';
  id: string;
  reasons?: string[];
}

/**
 * Step 20, with the vault (src/vault.ts). The log's one exception to append-only: under the forget, a fact's sealed
 * value may become its digest, computed here so that nothing else can be put in its place, and a header may lose its
 * sealed text. Nothing else about a row may change, and nobody but the forget's function can say it is forgetting.
 */
export const FORGET = `
create or replace function pelago_digest(v jsonb) returns jsonb language sql immutable as $fn$
  select case when jsonb_typeof(v) = 'object' and v ? '$n' and v ? '$c' then jsonb_build_object('$h', encode(sha256(
    decode(rpad(translate(v->>'$n', '-_', '+/'), (length(v->>'$n') + 3) / 4 * 4, '='), 'base64') ||
    decode(rpad(translate(v->>'$c', '-_', '+/'), (length(v->>'$c') + 3) / 4 * 4, '='), 'base64')), 'hex')) end
$fn$;
create or replace function pelago_log_append_only() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'UPDATE' and current_setting('pelago.forgetting', true) = 'on' then
    if tg_table_name = 'log_fact' then
      if (new.stream, new.pos, new.n, new.op, new.id, new.field) = (old.stream, old.pos, old.n, old.op, old.id, old.field)
         and new.meta is not distinct from old.meta and new.value = pelago_digest(old.value) then return new; end if;
    elsif (new.stream, new.pos, new.id, new.at, new.prev, new.hash) = (old.stream, old.pos, old.id, old.at, old.prev, old.hash)
         and new.undoes is not distinct from old.undoes then return new;
    end if;
  end if;
  raise exception 'The log is append-only: % on % is refused', tg_op, tg_table_name;
end $fn$;
create or replace function pelago_log_forget(ids text[], heads jsonb) returns void language plpgsql security definer set search_path = public as $fn$
begin
  perform set_config('pelago.forgetting', 'on', true);
  update log_fact set value = pelago_digest(value) where id = any(ids) and pelago_digest(value) is not null;
  update log_entry e set head = x.head from jsonb_to_recordset(heads) as x(stream text, pos bigint, head jsonb) where e.stream = x.stream and e.pos = x.pos;
  perform set_config('pelago.forgetting', 'off', true);
end $fn$;
create or replace function pelago_forget_stores(item text, reasons text[], held text[]) returns void language plpgsql security definer set search_path = public as $fn$
begin
  delete from picture where entity_id = item;
  delete from share where entity_id = item;
  delete from published where entity_id = item;
  update event set detail = '{"forgotten": true}' where target_id = item or detail->'absorbed'->>'id' = item;
  update event set reason = '', detail = detail #- '{authority,basis}' where changeset = any(reasons) or detail->>'proposal' = any(reasons);
  update proposal set ops = '[]', warnings = '[]', source = null, note = 'Forgotten with what it touched',
    status = case when status = 'pending' then 'superseded' else status end where id = any(held);
  update proposal set reason = '' where id = any(reasons);
end $fn$;
revoke execute on function pelago_log_forget(text[], jsonb), pelago_forget_stores(text, text[], text[]) from public;
grant execute on function pelago_log_forget(text[], jsonb), pelago_forget_stores(text, text[], text[]) to pelago_member;
`;

/**
 * Run statements as the tables' owner, in a transaction that may have dropped to a viewer's role: a forget reaches rows
 * its maker cannot see (an item private to someone else that the forgotten person owns). Back to that role after.
 */
export async function asOwner(tx: Q, statements: string[], params: unknown[]): Promise<void> {
  const { rows } = await tx.query<{ now: string; was: string }>(`select current_user as now, session_user as was`);
  if (rows[0].now !== rows[0].was) await tx.query(`reset role`);
  try {
    for (const sql of statements) await tx.query(sql, params);
  } finally {
    if (rows[0].now !== rows[0].was) await tx.query(`select set_config('role', $1, true)`, [rows[0].now]);
  }
}

/** Every link that ever had the item at either end, as the log says. */
async function linksOf(tx: Q, item: string): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(`select distinct id from log_fact where field = 'link' and op = '+' and (value->>1 = $1 or value->>2 = $1)`, [item]);
  return rows.map((r) => r.id);
}

/** Held changes that touch the item: a fact about it, or its id in what they ask. */
async function heldTouching(tx: Q, item: string, links: string[]): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `select e.id from log_entry e where e.stream = 'pending' and (exists (select 1 from log_fact f where f.stream = e.stream and f.pos = e.pos and f.id = any($1::text[]))
       or e.id in (select id from proposal where ops::text like $2 or warnings::text like $2))`,
    [[item, ...links], `%${item}%`],
  );
  return rows.map((r) => r.id);
}

/** The log, the vault and the stores beside the log, once the item is forgotten. Run in the forget's transaction. */
export async function forgetIn(tx: Q, op: ForgetOp): Promise<{ links: string[]; held: string[] }> {
  const reasons = op.reasons ?? [];
  const links = await linksOf(tx, op.id);
  const held = await heldTouching(tx, op.id, links);
  const { rows } = await tx.query<{ stream: string; pos: number; id: string; head: Record<string, any> }>(
    `select stream, pos::int as pos, id, head from log_entry where id = any($1::text[])`,
    [[...new Set([...reasons, ...held])]],
  );
  const heads = rows.map((r) => {
    const head = { ...r.head };
    if (reasons.includes(r.id)) {
      head.reason = digested(head.reason);
      if (head.authority?.basis !== undefined) head.authority = { ...head.authority, basis: digested(head.authority.basis) };
    }
    if (held.includes(r.id)) for (const field of ['ops', 'warnings', 'source']) if (head[field] != null) head[field] = digested(head[field]);
    return { stream: r.stream, pos: r.pos, head };
  });
  await tx.query(`select pelago_log_forget($1::text[], $2::jsonb)`, [[op.id, ...links], JSON.stringify(heads)]);
  await destroy(tx, [op.id, ...links, ...reasons, ...held.map((p) => `${p}/ops`)]);
  await tx.query(`select pelago_forget_stores($1, $2::text[], $3::text[])`, [op.id, reasons, held]);
  return { links, held };
}

/**
 * The change sets and held changes whose reason or basis mention an item, by its id or its title: what a forget offers
 * to forget with it. The log holds them sealed, and is read opened; events from before the log and the proposal table
 * hold them clear, and are searched.
 */
export async function mentions(q: Q, item: string): Promise<{ id: string; reason: string }[]> {
  const { rows: found } = await q.query<{ title: string }>(`select title from entity where id = $1`, [item]);
  const plain = [item, ...(found[0]?.title.trim().length > 3 ? [found[0].title.trim()] : [])];
  const words = plain.map((w) => `%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const { rows } = await q.query<{ id: string; reason: string }>(
    `select distinct coalesce(changeset, detail->>'proposal') as id, reason from event
       where coalesce(changeset, detail->>'proposal') is not null and (reason ilike any($1::text[]) or detail->'authority'->>'basis' ilike any($1::text[]))
     union select id, reason from proposal where reason ilike any($1::text[])`,
    [words],
  );
  const says = (text: unknown) => typeof text === 'string' && plain.some((w) => text.toLowerCase().includes(w.toLowerCase()));
  const out = new Map(rows.map((r) => [r.id, r]));
  for (let pos = 1, page = await entries(q, 'facts', pos); page.length; pos = page.at(-1)!.pos + 1, page = await entries(q, 'facts', pos)) {
    for (const e of page) if (says(e.reason) || says((e.authority as { basis?: unknown } | null)?.basis)) out.set(e.id, { id: e.id, reason: e.reason as string });
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}
