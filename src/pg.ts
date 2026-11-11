// A Postgres server behind Db: a pool of connections per database, a transaction on one connection, and values
// read back as PGlite gives them, so nothing else can tell which it has. The schema is applied as PGlite's is, with
// the steps only a server needs (src/migrate.ts).
//
// Tests run on a server too when PELAGO_TEST_DATABASE_URL names one: each database they open in memory is a new
// database copied from a template that holds the schema, dropped again when it is closed.

import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import type { Database, Q } from './db.ts';

// int8 (event.seq, count(*)) is a number while it is exact, as PGlite gives it; numeric stays a string in both.
const PARSERS: Record<number, (value: string) => unknown> = {
  20: (value) => (Number.isSafeInteger(Number(value)) ? Number(value) : BigInt(value)),
  1082: (value) => new Date(`${value}T00:00:00Z`), // a date is midnight UTC, not midnight here
};
const types = { getTypeParser: (oid: number, format?: 'text' | 'binary') => PARSERS[oid] ?? pg.types.getTypeParser(oid, format) } as pg.CustomTypesConfig;

const rowsOf = async <T>(client: pg.Pool | pg.PoolClient, sql: string, params?: unknown[]) => ({ rows: (await client.query(sql, params)).rows as T[] });

/** One database on a server, as a Database. Brings its schema up to date with `prepare` under a lock, one opener at a time. */
export async function openPg(url: string, prepare: (db: Database) => Promise<unknown>): Promise<Database> {
  const pool = new pg.Pool({ connectionString: url, max: 5, types });
  pool.on('error', () => {}); // an idle connection that drops is replaced on the next query
  const db: Database = {
    query: <T>(sql: string, params?: unknown[]) => rowsOf<T>(pool, sql, params),
    exec: (sql: string) => pool.query(sql),
    transaction: async <T>(fn: (tx: Q) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const done = await fn({ query: <R>(sql: string, params?: unknown[]) => rowsOf<R>(client, sql, params) });
        await client.query('commit');
        return done;
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  // Two openers at once (two servers, or the deploy step and a server) would apply the same step against each other.
  const client = await pool.connect();
  try {
    await client.query(`select pg_advisory_lock(hashtext('pelago.schema'))`);
    await prepare({ ...db, query: <T>(sql: string, params?: unknown[]) => rowsOf<T>(client, sql, params), exec: (sql: string) => client.query(sql) });
    // The login role switches to these per request (set local role): unless it is a superuser it must be a member.
    await client.query(`do $$ begin
      if not (select rolsuper from pg_roles where rolname = current_user) then execute format('grant pelago_member, pelago_public to %I', current_user); end if;
    end $$`);
  } catch (err) {
    await client.query(`select pg_advisory_unlock(hashtext('pelago.schema'))`).catch(() => {});
    client.release();
    await pool.end();
    throw err;
  }
  await client.query(`select pg_advisory_unlock(hashtext('pelago.schema'))`).catch(() => {});
  client.release();
  return db;
}

/** The same server, another database on it. */
const named = (url: string, database: string) => Object.assign(new URL(url), { pathname: `/${database}` }).toString();

/**
 * A new, empty database for one test, copied from a template made once per schema and role (the name carries their hash).
 * Closing it drops it.
 */
export async function scratchPg(url: string, schema: string, prepare: (db: Database) => Promise<unknown>): Promise<Database> {
  // The tables belong to whoever made the template, so a template is made per login role as well as per schema.
  const template = `pelago_t_${createHash('sha256').update(`${schema} ${decodeURIComponent(new URL(url).username)}`).digest('hex').slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const name = `pelago_s_${randomBytes(6).toString('hex')}`;
  try {
    await admin.query(`select pg_advisory_lock(hashtext($1))`, [template]);
    const made = (await admin.query(`select 1 from pg_database where datname = $1 and datistemplate`, [template])).rowCount;
    if (!made) {
      await admin.query(`drop database if exists ${template}`);
      await admin.query(`create database ${template}`);
      await (await openPg(named(url, template), prepare)).close();
      await admin.query(`alter database ${template} is_template true`);
    }
    await admin.query(`select pg_advisory_unlock(hashtext($1))`, [template]);
    await admin.query(`create database ${name} template ${template}`);
  } finally {
    await admin.end();
  }
  const db = await openPg(named(url, name), async () => {});
  const close = db.close;
  db.close = async () => {
    await close();
    const drop = new pg.Client({ connectionString: url });
    await drop.connect();
    await drop.query(`drop database if exists ${name}`).finally(() => drop.end());
  };
  return db;
}

/** A workspace's own database beside the default one: that name and _<id>, made on first use. */
export async function databaseFor(url: string, workspace: string, make = true): Promise<string> {
  const name = `${new URL(url).pathname.slice(1)}_${workspace.replaceAll('-', '_')}`;
  if (make) await asAdmin(url, async (admin) => {
    if (!(await admin.query(`select 1 from pg_database where datname = $1`, [name])).rowCount) await admin.query(`create database "${name}"`);
  });
  return named(url, name);
}

/** The database an address names, made when it is not there yet: a move's target. Says whether it was made. */
export async function makeDatabase(url: string): Promise<boolean> {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  const server = named(url, 'postgres');
  return asAdmin(server, async (admin) => {
    if ((await admin.query(`select 1 from pg_database where datname = $1`, [name])).rowCount) return false;
    await admin.query(`create database "${name.replaceAll('"', '""')}"`);
    return true;
  });
}

/** Drop the database an address names: a move's target that was made for it and not filled. */
export async function dropDatabase(url: string): Promise<void> {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  await asAdmin(named(url, 'postgres'), (admin) => admin.query(`drop database if exists "${name.replaceAll('"', '""')}" with (force)`));
}

/** Drop a workspace's own database: one whose making failed. */
export async function dropDatabaseFor(url: string, workspace: string): Promise<void> {
  const name = new URL(await databaseFor(url, workspace, false)).pathname.slice(1);
  await asAdmin(url, (admin) => admin.query(`drop database if exists "${name}" with (force)`));
}

async function asAdmin<T>(url: string, fn: (admin: pg.Client) => Promise<T>): Promise<T> {
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}
