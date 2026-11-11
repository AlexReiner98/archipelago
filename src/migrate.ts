// The schema in numbered steps, each applied once to a database and recorded in schema_version. Opening a database
// applies the steps it lacks, one opener at a time (a server's opener holds a lock: src/pg.ts); once it has them all,
// opening it is a check of its version, not the whole schema run again. `npm run migrate` (src/deploy.ts) applies them to the databases on a
// Postgres server as the deploy step, before the new app starts, so no app serving requests runs DDL under another.
//
// During a switch the old app and the new one run on the same database, so every step must suit both: add a column
// or a table in one step, use it in the next release, remove what is unused in a later one. Never rename or drop
// something the app before still reads. A step, once released, is never edited: add another.

import { createHash } from 'node:crypto';
import type { Database } from './db.ts';
import { AGENT_CODE_READ, AGENT_PUBLISH_READ, HELD_BY, HOLDS_OFF_READ, ITEM_HIDDEN, LINK_SNAPSHOT, MEMBER, ORDERED, SCHEMA, TOKEN_GRANT, TOKEN_SCOPE, VISIBILITY, WORKSPACE_SHARE } from './schema.ts';
import { ADOPT_APP, CONTROL, PACK_STORE } from './control.ts';
import { PUBLIC_DOCUMENT, PUBLIC_VIEW, PUBLISHED, PUBLISHED_PATH, SHARE_PUBLISHABLE, SHARE_WORKSPACE_GONE } from './public-schema.ts';
import { TRANSIENT } from './transient.ts';
import { ITEM_KIND } from './head.ts';
import { ISLAND_INDEX } from './island-items.ts';
import { SEARCH_ANY, SEARCH_INDEX } from './search.ts';
import { LOG } from './log.ts';
import { ACTIVITY, ACTIVITY_STREAM, EVENT_GONE, OP_ABOUT, PRE_LOG_ACTIVITY } from './activity-steps.ts';
import { carryEventTable } from './activity.ts';
import { VAULT } from './vault.ts';
import { FORGET, FORGET_STORES } from './forget.ts';
import { OPLOG, OPLOG_GUARDED, OPLOG_SERVER } from './oplog.ts';
import { PARTITION } from './partitions.ts';
import { SNAPSHOT } from './snapshot.ts';
import { CLOSURE } from './closure.ts';
import { MENTIONS } from './mentions.ts';
import { ITEM_BYTES } from './bytes.ts';
import { ACTIVE_HOLDS_BY_KEY, READ_INDEXES, ROW_POLICIES } from './read-indexes.ts';
import { GUEST_READER } from './guest-schema.ts';

interface Migration {
  version: number;
  name: string;
  /** Run on every database. */
  sql: string;
  /** Run on a Postgres server only, after sql: what many connections need and PGlite does not. */
  server?: string;
  /**
   * Run first, in transactions of its own, when what the step's SQL removes must be carried somewhere only the app can
   * write (a sealed stream). It must be safe to run again: a step that fails after it is begun again whole.
   */
  before?: (db: Database) => Promise<unknown>;
}

export const MIGRATIONS: Migration[] = [
  // What every database had before steps were numbered, written so it can run again over it: a database made then
  // takes it as its first step without harm.
  { version: 1, name: 'the schema before versions', sql: `create extension if not exists pg_trgm;\n${SCHEMA}\n${VISIBILITY}` },
  { version: 2, name: 'writes in order on a server', sql: '', server: ORDERED },
  { version: 3, name: 'what one request leaves for the next', sql: TRANSIENT },
  { version: 4, name: 'what the server kept on its disk', sql: CONTROL },
  { version: 5, name: 'a token is within some items, and may report, propose or change', sql: TOKEN_SCOPE },
  { version: 6, name: 'members sign in by their email address', sql: MEMBER },
  { version: 7, name: 'a document shared with another workspace', sql: WORKSPACE_SHARE },
  { version: 8, name: 'what a server pack keeps', sql: PACK_STORE },
  { version: 9, name: 'a public document, read by anyone', sql: PUBLIC_DOCUMENT },
  { version: 10, name: 'a document as it was published', sql: PUBLISHED },
  { version: 11, name: 'a published document at an address word', sql: PUBLISHED_PATH },
  { version: 12, name: 'an agent reads whether it may publish', sql: AGENT_PUBLISH_READ },
  { version: 13, name: 'the GitHub App as a server pack', sql: ADOPT_APP },
  { version: 14, name: 'an agent reads whether it may change the code drawings run', sql: AGENT_CODE_READ },
  { version: 15, name: 'an item keeps its kind in its row', sql: ITEM_KIND },
  { version: 16, name: 'a held change keeps the rule that held it', sql: HELD_BY },
  { version: 17, name: 'titles and notes indexed for search', sql: SEARCH_INDEX },
  { version: 18, name: 'the log: change sets appended, hash-chained', sql: LOG },
  { version: 19, name: 'the activity log read from the log', sql: ACTIVITY },
  { version: 20, name: 'per-item keys in a vault, and forgetting', sql: VAULT + FORGET },
  { version: 21, name: 'the compacted streams, in segments', sql: OPLOG, server: OPLOG_SERVER },
  { version: 22, name: 'the log cut by year', sql: PARTITION },
  { version: 23, name: 'snapshots of the projections, and room to rebuild them', sql: SNAPSHOT },
  { version: 24, name: 'the compacted streams sealed, guarded by row, and reached by a forget', sql: OPLOG_GUARDED },
  { version: 25, name: 'what is inside what, what names what, the indexes reads are bounded by, and visibility asked row by row', sql: CLOSURE + MENTIONS + READ_INDEXES + ROW_POLICIES + ACTIVE_HOLDS_BY_KEY },
  { version: 26, name: 'a document shared with another workspace may be published there', sql: SHARE_PUBLISHABLE },
  { version: 27, name: 'the activity from before the log began, gone', sql: PRE_LOG_ACTIVITY },
  { version: 28, name: 'what each item adds to the log, in bytes', sql: ITEM_BYTES },
  { version: 29, name: 'a token a person granted a client by signing in', sql: TOKEN_GRANT },
  { version: 30, name: 'search finds an item with any of the words', sql: SEARCH_ANY },
  { version: 31, name: 'an agent reads whether holds are off', sql: HOLDS_OFF_READ },
  { version: 32, name: 'what lives on an island', sql: ISLAND_INDEX },
  { version: 33, name: 'what was done outside change sets, in the activity stream', sql: ACTIVITY_STREAM },
  { version: 34, name: 'the event table, carried into the activity stream and gone', sql: EVENT_GONE + FORGET_STORES, before: carryEventTable },
  { version: 35, name: 'a get says hidden, not missing', sql: ITEM_HIDDEN },
  { version: 36, name: 'a view shared with a guest, read live and nothing else', sql: GUEST_READER },
  { version: 37, name: 'a link keeps its view frozen, read by a short token', sql: LINK_SNAPSHOT },
  { version: 38, name: 'what the compacted streams say about an item, found by its index under the row policy', sql: OP_ABOUT },
  { version: 39, name: 'shares made out to another workspace, gone', sql: SHARE_WORKSPACE_GONE },
  { version: 40, name: 'a view or an item made public, frozen as it was shared', sql: PUBLIC_VIEW },
];

export const LATEST = MIGRATIONS.at(-1)!.version;

/** A name for the schema the steps make on each driver: a database made from them once can be copied for another. */
export const schemaKey = (server: boolean) =>
  createHash('sha256').update(MIGRATIONS.map((m) => m.sql + (server ? (m.server ?? '') : '')).join('\n')).digest('hex').slice(0, 12);

/** The step a database is at: 0 when it has no record of steps. */
export async function versionOf(db: Database): Promise<number> {
  const [{ made }] = (await db.query<{ made: boolean }>(`select to_regclass('schema_version') is not null as made`)).rows;
  if (!made) return 0;
  return (await db.query<{ v: number | null }>(`select max(version) as v from schema_version`)).rows[0].v ?? 0;
}

/**
 * Apply the steps a database lacks, each in a transaction of its own with its record. A database ahead of this code
 * (the new app migrated it, and this is the old one, still serving) is left as it is.
 */
export async function migrate(db: Database, server: boolean): Promise<{ from: number; to: number }> {
  const from = await versionOf(db);
  if (from === 0) await db.exec(`create table if not exists schema_version (version int primary key, name text not null, applied_at timestamptz not null default now())`);
  for (const m of MIGRATIONS.filter((m) => m.version > from)) {
    const sql = m.sql + (server && m.server ? `\n${m.server}` : '');
    try {
      await m.before?.(db);
      await db.exec(`begin;\n${sql}\ninsert into schema_version (version, name) values (${m.version}, '${m.name.replaceAll("'", "''")}');\ncommit;`);
    } catch (err) {
      await db.exec('rollback').catch(() => {});
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${(err as Error).message}`, { cause: err });
    }
  }
  if (from > 0) await remake(db, server, from);
  return { from, to: Math.max(from, LATEST) };
}

/** The tables each step makes and no later step drops: what a database recorded as past that step must have. */
const MADE = MIGRATIONS.map((m) => {
  const later = MIGRATIONS.filter((n) => n.version > m.version).map((n) => n.sql + (n.server ?? '')).join('\n');
  const made = [...m.sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)].map((t) => t[1].toLowerCase());
  return { m, tables: [...new Set(made)].filter((t) => !new RegExp(`drop\\s+table\\s+(?:if\\s+exists\\s+)?${t}\\b`, 'i').test(later)) };
}).filter((s) => s.tables.length);

/**
 * A step recorded as applied whose tables are not there is run again (its record kept): a local map once said it was
 * past step 6 and had no member table, so every backup of it failed. One query when nothing is missing.
 */
async function remake(db: Database, server: boolean, at: number) {
  const steps = MADE.filter((s) => s.m.version <= at);
  const names = [...new Set(steps.flatMap((s) => s.tables))];
  const { rows } = await db.query<{ name: string }>(`select n as name from unnest($1::text[]) n where to_regclass(n) is null`, [names]);
  const missing = new Set(rows.map((r) => r.name));
  for (const { m, tables } of steps.filter((s) => s.tables.some((t) => missing.has(t)))) {
    console.error(`Schema step ${m.version} (${m.name}) is recorded, but ${tables.filter((t) => missing.has(t)).join(', ')} is missing: running it again.`);
    const sql = m.sql + (server && m.server ? `\n${m.server}` : '');
    try {
      await db.exec(`begin;\n${sql}\ncommit;`);
    } catch (err) {
      await db.exec('rollback').catch(() => {});
      throw new Error(`Migration ${m.version} (${m.name}) was recorded without its tables, and running it again failed: ${(err as Error).message}`, { cause: err });
    }
  }
}
