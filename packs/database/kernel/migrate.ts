// The schema in numbered steps, each applied once to a database and recorded in schema_version. Opening a database
// applies the steps it lacks, one opener at a time (a server's opener holds a lock: src/pg.ts); once it has them all,
// opening it is a check of its version, not the whole schema run again. `npm run migrate` (src/deploy.ts) applies them to the databases on a
// Postgres server as the deploy step, before the new app starts, so no app serving requests runs DDL under another.
//
// During a switch the old app and the new one run on the same database, so every step must suit both: add a column
// or a table in one step, use it in the next release, remove what is unused in a later one. Never rename or drop
// something the app before still reads. A step, once released, is never edited: add another.
//
// Each root declares its own parts of the steps in its kernel/steps.ts (STEPS), and what it does to a database each
// time it is opened, once the steps are in (OPENED); they are read in the order packs/roots.json starts the roots
// (src/root-fills.ts), when a database is first opened. A step is numbered once for all the roots: its parts, where
// more than one root has one, are joined in the order each names (`part`), so its SQL is what it was when released.

import { createHash } from 'node:crypto';
import type { Database } from './db.ts';
import { rootFills } from './root-fills.ts';

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

/** A root's part of a numbered step, as its kernel/steps.ts declares it: the part that comes first names the step. */
export interface StepPart {
  version: number;
  /** The step's name: given by its first part, and only there. */
  name?: string;
  /** Where the part goes in its step, from 0, when the step has parts of more than one root. */
  part?: number;
  sql: string;
  server?: string;
  before?: (db: Database) => Promise<unknown>;
}

/** Every root's parts made into the steps, in order; refused when a step is missing, unnamed or named twice. */
export function joinSteps(parts: { root: string; value: StepPart }[]): Migration[] {
  const by = new Map<number, { root: string; value: StepPart }[]>();
  for (const p of parts) by.set(p.value.version, [...(by.get(p.value.version) ?? []), p]);
  const versions = [...by.keys()].sort((a, b) => a - b);
  return versions.map((version, i) => {
    if (version !== i + 1) throw new Error(`The schema's steps skip from ${i} to ${version}: every step is numbered once, from 1`);
    const ps = by.get(version)!.sort((a, b) => (a.value.part ?? 0) - (b.value.part ?? 0));
    const named = ps.filter((p) => p.value.name !== undefined);
    if (named.length !== 1 || named[0] !== ps[0]) throw new Error(`Step ${version} is named by ${named.map((p) => p.root).join(', ') || 'no root'}: its first part names it, and only that`);
    const at = ps.map((p) => p.value.part ?? 0);
    if (new Set(at).size !== at.length) throw new Error(`Step ${version} has two parts at one place (${ps.map((p) => p.root).join(', ')})`);
    const server = ps.filter((p) => p.value.server !== undefined);
    const before = ps.flatMap((p) => p.value.before ?? []);
    return {
      version,
      name: ps[0].value.name!,
      sql: ps.map((p) => p.value.sql).join(''),
      ...(server.length ? { server: server.map((p) => p.value.server).join('') } : {}),
      ...(before.length ? { before: async (db: Database) => { for (const run of before) await run(db); } } : {}),
    };
  });
}

let steps: Promise<Migration[]> | undefined;
/** The steps, read from the roots once. The same array each time: a test may add a step to it. */
export const migrations = (): Promise<Migration[]> => (steps ??= rootFills<StepPart[]>('steps.ts', 'STEPS').then((fills) => joinSteps(fills.flatMap(({ root, value }) => value.map((v) => ({ root, value: v }))))));

/** The step the newest database is at. */
export const latest = async () => (await migrations()).at(-1)!.version;

/** A name for the schema the steps make on each driver: a database made from them once can be copied for another. */
export const schemaKey = async (server: boolean) =>
  createHash('sha256').update((await migrations()).map((m) => m.sql + (server ? (m.server ?? '') : '')).join('\n')).digest('hex').slice(0, 12);

/** Bring a database to the latest step, then what each root does to a database each time it is opened (OPENED). */
export async function prepare(db: Database, server: boolean): Promise<void> {
  await migrate(db, server);
  for (const { value } of await rootFills<((db: Database) => Promise<unknown>)[]>('steps.ts', 'OPENED')) for (const run of value) await run(db);
}

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
  const all = await migrations();
  const from = await versionOf(db);
  if (from === 0) await db.exec(`create table if not exists schema_version (version int primary key, name text not null, applied_at timestamptz not null default now())`);
  for (const m of all.filter((m) => m.version > from)) {
    const sql = m.sql + (server && m.server ? `\n${m.server}` : '');
    try {
      await m.before?.(db);
      await db.exec(`begin;\n${sql}\ninsert into schema_version (version, name) values (${m.version}, '${m.name.replaceAll("'", "''")}');\ncommit;`);
    } catch (err) {
      await db.exec('rollback').catch(() => {});
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${(err as Error).message}`, { cause: err });
    }
  }
  if (from > 0) await remake(db, server, from, all);
  return { from, to: Math.max(from, all.at(-1)!.version) };
}

/** The tables each step makes and no later step drops: what a database recorded as past that step must have. */
const made = (all: Migration[]) => all.map((m) => {
  const later = all.filter((n) => n.version > m.version).map((n) => n.sql + (n.server ?? '')).join('\n');
  const tables = [...m.sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)].map((t) => t[1].toLowerCase());
  return { m, tables: [...new Set(tables)].filter((t) => !new RegExp(`drop\\s+table\\s+(?:if\\s+exists\\s+)?${t}\\b`, 'i').test(later)) };
}).filter((s) => s.tables.length);

/**
 * A step recorded as applied whose tables are not there is run again (its record kept): a local map once said it was
 * past step 6 and had no member table, so every backup of it failed. One query when nothing is missing.
 */
async function remake(db: Database, server: boolean, at: number, all: Migration[]) {
  const recorded = made(all).filter((s) => s.m.version <= at);
  const names = [...new Set(recorded.flatMap((s) => s.tables))];
  const { rows } = await db.query<{ name: string }>(`select n as name from unnest($1::text[]) n where to_regclass(n) is null`, [names]);
  const missing = new Set(rows.map((r) => r.name));
  for (const { m, tables } of recorded.filter((s) => s.tables.some((t) => missing.has(t)))) {
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

