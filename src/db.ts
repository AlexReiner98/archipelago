// Embedded Postgres (PGlite). The same schema runs on a Postgres server.

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { migrate, schemaKey } from './migrate.ts';
import { openPg, scratchPg } from './pg.ts';

/** Anything that can run a query: the database or a transaction on it. */
export interface Q {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** What the application needs of a database: the real one, or one scoped to a viewer. */
export interface Db extends Q {
  transaction<T>(fn: (tx: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The database itself, PGlite's or a server's: a Db that can also run several statements at once. */
export interface Database extends Db {
  exec(sql: string): Promise<unknown>;
}

export const isServer = (where: string) => /^postgres(ql)?:\/\//.test(where);

/** Open the database at a folder or on a server (a postgres:// address), or in memory when neither is given. */
export async function openDb(where?: string): Promise<Database> {
  if (!where) return inMemory();
  if (isServer(where)) return openPg(where, (db) => prepared(db, true));
  mkdirSync(where, { recursive: true });
  return prepared(new PGlite(where, { extensions: { pg_trgm } }));
}

// The steps of the schema this database lacks (src/migrate.ts). pg_trgm, which search uses for near-misses and typos,
// is in the first; a Postgres server has it too.
async function prepared<D extends Database>(db: D, server = false) {
  await migrate(db, server).catch(async (err) => {
    if (!server) await db.close(); // a server's pool is closed by its opener
    throw err;
  });
  return db;
}

// Only the tests open databases in memory, hundreds of them. Making one runs initdb and the whole schema (about a
// second); loading an image of one made once per process takes a fifth of that. Each holds a few hundred MB, so the
// tests close what each one opened as it ends (test/each.ts). With PELAGO_TEST_DATABASE_URL they are databases on
// that server instead (src/pg.ts).

/** Databases in memory not yet closed. */
export const openInMemory = new Set<Database>();
let blank: Promise<File | Blob> | undefined;

async function inMemory() {
  const server = process.env.PELAGO_TEST_DATABASE_URL;
  const db: Database = server ? await scratchPg(server, schemaKey(true), (db) => prepared(db, true)) : await PGlite.create({ loadDataDir: await (blank ??= blankImage()), extensions: { pg_trgm } });
  openInMemory.add(db);
  const close = db.close.bind(db);
  db.close = async () => {
    if (openInMemory.delete(db)) await close(); // closed by the test's end, then by its server's: once
  };
  return db;
}

async function blankImage() {
  const db = await prepared(new PGlite({ extensions: { pg_trgm } }));
  const image = await db.dumpDataDir('none');
  await db.close();
  return image;
}

/**
 * The same database as one person sees it. Every statement runs inside a
 * transaction that first drops to the member role and names the viewer (and
 * whether they are an admin of the workspace), so neither can leak between
 * requests sharing the connection.
 */
export function scoped(db: Db, viewer: string, admin = false): Db {
  const enter = async (tx: Q) => {
    await tx.query(`select set_config('pelago.viewer', $1, true), set_config('pelago.admin', $2, true)`, [viewer, admin ? '1' : '']);
    await tx.query(`set local role pelago_member`);
  };
  return {
    query: <T>(sql: string, params?: unknown[]) =>
      db.transaction(async (tx) => {
        await enter(tx);
        return tx.query<T>(sql, params);
      }),
    transaction: <T>(fn: (tx: Q) => Promise<T>) =>
      db.transaction(async (tx) => {
        await enter(tx);
        return fn(tx);
      }),
    close: () => db.close(),
  };
}

/** The same database as anyone at all sees it, with no login: only what is public, and only some columns of that. */
export function anyone(db: Db): Db {
  const enter = (tx: Q) => tx.query(`set local role pelago_public`);
  return {
    query: <T>(sql: string, params?: unknown[]) =>
      db.transaction(async (tx) => {
        await enter(tx);
        return tx.query<T>(sql, params);
      }),
    transaction: <T>(fn: (tx: Q) => Promise<T>) =>
      db.transaction(async (tx) => {
        await enter(tx);
        return fn(tx);
      }),
    close: () => db.close(),
  };
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newId(prefix: string): string {
  let out = '';
  for (const byte of randomBytes(8)) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}
