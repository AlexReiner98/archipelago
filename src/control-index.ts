// What a request with no workspace open yet may be answered from: which workspaces an email address is a member of,
// and which workspace a token was made for, kept in the control values (src/control.ts). So a sign-in opens only the
// workspaces of its address, and a token nobody made opens none (the audit of 29 Oct 2026).
//
// These are indexes, not the record: a workspace's member and token tables say who belongs and who may act, and are
// still asked. An entry is added where a member is admitted or a token made, a member's taken out where they are
// removed, and a workspace's whole lists are added again after a restore; one left behind only costs a look. A
// database that has never had an index is indexed once, from every workspace, when it is first asked.

import type { Q } from './db.ts';

let control: (() => Promise<Q>) | undefined;
/** The server's own database, said once when the server starts. Without it, nothing is noted. */
export function configureIndex(given: () => Promise<Q>) {
  control = given;
}

const memberKey = (email: string) => `member_in:${email}`;
const tokenKey = (hash: string) => `token_for:${hash}`;
const BUILT = 'index_built';

type Every = () => Promise<{ id: string; db: () => Promise<Q> }[]>;

async function addMember(c: Q, email: string, workspace: string): Promise<void> {
  await c.query(
    `insert into control_value (key, value) values ($1, jsonb_build_array($2::text))
     on conflict (key) do update set value = case when control_value.value ? $2 then control_value.value else control_value.value || jsonb_build_array($2::text) end`,
    [memberKey(email), workspace],
  );
}
const addToken = (c: Q, hash: string, workspace: string) => c.query(`insert into control_value (key, value) values ($1, to_jsonb($2::text)) on conflict (key) do nothing`, [tokenKey(hash), workspace]);

/** Note whether this address is a member of this workspace. */
export async function indexMember(email: string, workspace: string, member: boolean): Promise<void> {
  const c = await control?.();
  if (!c) return;
  if (member) await addMember(c, email, workspace);
  else await c.query(`update control_value set value = value - $2::text where key = $1`, [memberKey(email), workspace]);
}

/** Note a token made, by its hash. */
export async function indexToken(hash: string, workspace: string): Promise<void> {
  const c = await control?.();
  if (c) await addToken(c, hash, workspace);
}

/** A token's old hash leaves the index when its secret is rotated. */
export async function unindexed(hash: string): Promise<void> {
  const c = await control?.();
  if (c) await unindexToken(c, hash);
}

/** Every member and live token a workspace's database holds, noted: after a restore, or when the index is first made. */
export async function indexWorkspace(c: Q, workspace: string, db: Q): Promise<void> {
  for (const { email } of (await db.query<{ email: string }>(`select email from member where removed_at is null`)).rows) await addMember(c, email, workspace);
  const live = await db.query<{ hash: string }>(`select hash from token where revoked_at is null and (expires_at is null or expires_at > now())`);
  for (const { hash } of live.rows) await addToken(c, hash, workspace);
}

/** The databases known to have both indexes, so a signed-in request asks only for its own entry. */
const made = new WeakSet<Q>();

/** Made once per database, from every workspace, the first time either index is asked. */
async function built(c: Q, all: Every): Promise<void> {
  if (made.has(c)) return;
  if (!(await c.query(`select 1 from control_value where key = $1`, [BUILT])).rows.length) {
    for (const ws of await all()) await indexWorkspace(c, ws.id, await ws.db());
    await c.query(`insert into control_value (key, value) values ($1, 'true'::jsonb) on conflict (key) do nothing`, [BUILT]);
  }
  made.add(c);
}

/** The workspaces this address is a member of, as the index says. */
export async function workspacesOf(c: Q, email: string, all: Every): Promise<string[]> {
  await built(c, all);
  return (await c.query<{ value: string[] }>(`select value from control_value where key = $1`, [memberKey(email)])).rows[0]?.value ?? [];
}

/** Whether a token by this hash was made for this workspace, as the index says. */
export async function tokenKnown(c: Q, hash: string, workspace: string, all: Every): Promise<boolean> {
  await built(c, all);
  return (await c.query<{ value: string }>(`select value from control_value where key = $1`, [tokenKey(hash)])).rows[0]?.value === workspace;
}

/** A token found no good (revoked or run out) leaves the index. */
export async function unindexToken(c: Q, hash: string): Promise<void> {
  await c.query(`delete from control_value where key = $1`, [tokenKey(hash)]);
}
