// The key vault (docs/log.md, section 5): one AES-256-GCM key for each item, each link with fields and each change set
// with free text, kept outside the log in the workspace's own database, so a forget is one transaction (the owner,
// e_98cdhgn6). Each key is stored wrapped with the server's sealing key (src/secrets.ts), which is never in a database
// or a backup. A key is deleted only by a forget, and deleted for real: what it sealed is never read again. Secrets live
// here too (e_7cv7xefh), by name. The vault is backed up apart from the log, and those backups are kept 30 days.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Q } from './db.ts';
import { sealingKey } from './secrets.ts';

/** How long a backup of the vault is kept: a forgotten item can be brought back for this long at most. */
export const VAULT_BACKUP_DAYS = 30;

/**
 * Step 20, with the forget's own (src/forget.ts). A member may read and add keys, never change one; deleting goes
 * through the one function a forget calls.
 */
export const VAULT = `
create table if not exists vault_key (
  ws         text not null,
  id         text not null,
  version    int not null,
  wrapped    bytea not null,
  created_at timestamptz not null default now(),
  primary key (id, version)
);
create table if not exists vault_secret (
  ws         text not null,
  name       text not null,
  version    int not null,
  wrapped    bytea not null,
  created_at timestamptz not null default now(),
  primary key (name, version)
);
revoke update, delete, truncate on vault_key, vault_secret from public;
grant select, insert on vault_key to pelago_member;
create or replace function pelago_vault_destroy(ids text[]) returns int language sql security definer set search_path = public as $fn$
  with gone as (delete from vault_key where id = any(ids) returning 1) select count(*)::int from gone
$fn$;
revoke execute on function pelago_vault_destroy(text[]) from public;
grant execute on function pelago_vault_destroy(text[]) to pelago_member;
`;

/** One key of one item, at one version, with the workspace it was made in (the additional data names it). */
export interface Key {
  ws: string;
  id: string;
  version: number;
  key: Buffer;
}

const aad = (...parts: (string | number)[]) => Buffer.from(parts.join('\0'), 'utf8');

function wrap(ws: string, id: string, version: number, key: Buffer, kek = sealingKey()): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  cipher.setAAD(aad(ws, id, version));
  const body = Buffer.concat([cipher.update(key), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

// Unwrapped keys by their wrapped bytes: a replay unwraps each key once. The wrapped bytes name the key's workspace,
// item and version, so a key found here is the one the vault row holds; a row deleted is never looked up again.
const unwrapped = new Map<string, Buffer>();

function unwrap(ws: string, id: string, version: number, wrapped: Buffer, kek?: Buffer): Buffer | undefined {
  const known = wrapped.toString('base64');
  const hit = unwrapped.get(known);
  if (hit) return hit;
  try {
    const decipher = createDecipheriv('aes-256-gcm', kek ?? sealingKey(false), wrapped.subarray(0, 12));
    decipher.setAAD(aad(ws, id, version));
    decipher.setAuthTag(wrapped.subarray(12, 28));
    const key = Buffer.concat([decipher.update(wrapped.subarray(28)), decipher.final()]);
    if (unwrapped.size > 100_000) unwrapped.clear();
    unwrapped.set(known, key);
    return key;
  } catch {
    return undefined; // wrapped on another server, or with a sealing key since lost
  }
}

/** Every version of the keys of these ids that the vault holds. */
export async function keysOf(q: Q, ids: string[]): Promise<Map<string, Key[]>> {
  const out = new Map<string, Key[]>();
  if (!ids.length) return out;
  const { rows } = await q.query<{ ws: string; id: string; version: number; wrapped: Uint8Array }>(
    `select ws, id, version, wrapped from vault_key where id = any($1::text[]) order by id, version`,
    [ids],
  );
  for (const r of rows) {
    const key = unwrap(r.ws, r.id, r.version, Buffer.from(r.wrapped));
    if (!key) continue;
    out.set(r.id, [...(out.get(r.id) ?? []), { ws: r.ws, id: r.id, version: r.version, key }]);
  }
  return out;
}

/** The keys of these ids that a vault backup holds, opened with this server's sealing key. */
export function keysIn(dump: VaultDump, ids: Set<string>): Map<string, Key[]> {
  const out = new Map<string, Key[]>();
  for (const r of dump.keys ?? []) {
    if (!ids.has(r.id)) continue;
    const key = unwrap(r.ws, r.id, r.version, Buffer.from(r.wrapped, 'base64'));
    if (key) out.set(r.id, [...(out.get(r.id) ?? []), { ws: r.ws, id: r.id, version: r.version, key }]);
  }
  return out;
}

/** The newest key of each id, made where there is none: keys are created with what they seal, in its transaction. */
export async function keysFor(q: Q, ws: string, ids: string[]): Promise<Map<string, Key>> {
  const held = await keysOf(q, ids);
  const out = new Map<string, Key>();
  const made: Key[] = [];
  for (const id of ids) {
    const newest = held.get(id)?.at(-1);
    if (newest) out.set(id, newest);
    else made.push({ ws, id, version: 1, key: randomBytes(32) });
  }
  if (made.length) {
    await q.query(
      `insert into vault_key (ws, id, version, wrapped) select $1, x.id, 1, decode(x.w, 'base64') from jsonb_to_recordset($2::jsonb) as x(id text, w text)`,
      [ws, JSON.stringify(made.map((k) => ({ id: k.id, w: wrap(ws, k.id, 1, k.key).toString('base64') })))],
    );
    for (const k of made) out.set(k.id, k);
  }
  return out;
}

/** A new version of an item's key: what is sealed from now on uses it; what was sealed before keeps its own. */
export async function rotate(q: Q, ws: string, id: string): Promise<Key> {
  const { rows } = await q.query<{ v: number | null }>(`select max(version) as v from vault_key where id = $1`, [id]);
  const key: Key = { ws, id, version: (rows[0].v ?? 0) + 1, key: randomBytes(32) };
  await q.query(`insert into vault_key (ws, id, version, wrapped) values ($1, $2, $3, $4)`, [ws, id, key.version, wrap(ws, id, key.version, key.key)]);
  return key;
}

/** Delete every version of these keys, for real. Only a forget calls it. */
export async function destroy(q: Q, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const { rows } = await q.query<{ n: number }>(`select pelago_vault_destroy($1::text[]) as n`, [ids]);
  return rows[0].n;
}

/** A secret kept by name (a model account, a pack's webhook or host secret), wrapped like a key. */
export async function putSecret(q: Q, ws: string, name: string, value: string): Promise<void> {
  const { rows } = await q.query<{ v: number | null }>(`select max(version) as v from vault_secret where name = $1`, [name]);
  const version = (rows[0].v ?? 0) + 1;
  await q.query(`insert into vault_secret (ws, name, version, wrapped) values ($1, $2, $3, $4)`, [ws, name, version, wrap(ws, `secret:${name}`, version, Buffer.from(value, 'utf8'))]);
}

/** The newest version of a secret, or undefined when there is none or it cannot be opened here. */
export async function getSecret(q: Q, name: string): Promise<string | undefined> {
  const { rows } = await q.query<{ ws: string; version: number; wrapped: Uint8Array }>(`select ws, version, wrapped from vault_secret where name = $1 order by version desc limit 1`, [name]);
  const r = rows[0];
  return r && unwrap(r.ws, `secret:${name}`, r.version, Buffer.from(r.wrapped))?.toString('utf8');
}

/** Remove a secret, every version of it. */
export async function removeSecret(q: Q, name: string): Promise<void> {
  await q.query(`delete from vault_secret where name = $1`, [name]);
}

/** The vault as a backup holds it: keys still wrapped, so the file gives up nothing without the sealing key. */
export interface VaultDump {
  format: 1;
  vault: true;
  taken: string;
  keys: { ws: string; id: string; version: number; wrapped: string; created_at: string }[];
  secrets: { ws: string; name: string; version: number; wrapped: string; created_at: string }[];
}

export async function dumpVault(q: Q): Promise<VaultDump> {
  const read = (table: string, name: string) =>
    q.query<any>(`select ws, ${name}, version, encode(wrapped, 'base64') as wrapped, created_at from ${table} order by ${name}, version`).then((r) => r.rows);
  return { format: 1, vault: true, taken: new Date().toISOString(), keys: await read('vault_key', 'id'), secrets: await read('vault_secret', 'name') };
}

/**
 * A vault backup's keys wrapped again: from this server's sealing key to `to`, or from `from` to this server's. A
 * download carries its keys under a key of its own, given only in its answer (e_98ddd7ha), and the server that takes
 * it in wraps them under its own. A key that does not open is left out.
 */
export function rewrap(dump: VaultDump, from?: Buffer, to?: Buffer): VaultDump {
  const again = <T extends { ws: string; version: number; wrapped: string }>(rows: T[], id: (r: T) => string) =>
    rows.flatMap((r) => {
      const key = unwrap(r.ws, id(r), r.version, Buffer.from(r.wrapped, 'base64'), from);
      return key ? [{ ...r, wrapped: wrap(r.ws, id(r), r.version, key, to).toString('base64') }] : [];
    });
  return { ...dump, keys: again(dump.keys, (r) => r.id), secrets: again(dump.secrets, (r) => `secret:${r.name}`) };
}

/** Put a vault backup back, beside the keys already there. */
export async function restoreVault(q: Q, dump: VaultDump): Promise<number> {
  if (dump?.vault !== true || dump.format !== 1) throw new Error('That is not a backup of the key vault.');
  const put = (table: string, name: string, rows: unknown[]) =>
    rows.length
      ? q.query(
          `insert into ${table} (ws, ${name}, version, wrapped, created_at) select x.ws, x.${name}, x.version, decode(x.wrapped, 'base64'), x.created_at
           from jsonb_to_recordset($1::jsonb) as x(ws text, ${name} text, version int, wrapped text, created_at timestamptz) on conflict do nothing`,
          [JSON.stringify(rows)],
        )
      : undefined;
  await put('vault_key', 'id', dump.keys);
  await put('vault_secret', 'name', dump.secrets);
  return dump.keys.length + dump.secrets.length;
}
