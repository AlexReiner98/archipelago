// The deploy step, `npm run migrate`: every database on the Postgres server, the default one and each workspace's,
// brought to the latest step of the schema (src/migrate.ts) before the new app starts. A database in a folder has one
// server and is migrated by it as it starts.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../database/kernel/config.ts';
import { listWorkspaces } from './control.ts';
import { openDb } from '../../database/kernel/db.ts';
import { latest, versionOf } from '../../database/kernel/migrate.ts';
import { databaseFor } from '../../database/kernel/pg.ts';

async function deploy() {
  const { dataDir, databaseUrl } = loadConfig();
  if (!databaseUrl) {
    console.error('PELAGO_DATABASE_URL is not set. A database in a folder is migrated by the server that opens it, as it starts.');
    process.exit(1);
  }
  // The default database first: it lists the others. A server not yet started on it since the list moved there has
  // it still in the file beside its data.
  const main = await openDb(databaseUrl);
  const LATEST = await latest();
  const listed = (await listWorkspaces(main)).map((w) => w.id);
  console.log(`default: at step ${await versionOf(main)} of ${LATEST}`);
  await main.close();
  const index = join(dataDir, '..', 'workspaces', 'index.json');
  const filed: string[] = existsSync(index) ? JSON.parse(readFileSync(index, 'utf8')).workspaces.map((w: { id: string }) => w.id) : [];
  for (const id of new Set([...listed, ...filed])) {
    const db = await openDb(await databaseFor(databaseUrl, id));
    const at = await versionOf(db);
    await db.close();
    console.log(`${id}: at step ${at} of ${LATEST}`);
  }
}

// Run as `node src/deploy.ts` too (the hosted deploy script does), through the shim the wave leaves there.
const ranAs = process.argv[1] ? resolve(process.argv[1]) : '';
if (import.meta.main || ranAs === resolve(import.meta.dirname, '../../../src/deploy.ts')) await deploy();
