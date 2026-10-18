// The deploy step, `npm run migrate`: every database on the Postgres server, the default one and each workspace's,
// brought to the latest step of the schema (src/migrate.ts) before the new app starts. A database in a folder has one
// server and is migrated by it as it starts.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { LATEST, versionOf } from './migrate.ts';
import { databaseFor } from './pg.ts';

async function deploy() {
  const { dataDir, databaseUrl } = loadConfig();
  if (!databaseUrl) {
    console.error('PELAGO_DATABASE_URL is not set. A database in a folder is migrated by the server that opens it, as it starts.');
    process.exit(1);
  }
  const index = join(dataDir, '..', 'workspaces', 'index.json');
  const ids: string[] = existsSync(index) ? JSON.parse(readFileSync(index, 'utf8')).workspaces.map((w: { id: string }) => w.id) : [];
  for (const id of ['default', ...ids]) {
    const db = await openDb(id === 'default' ? databaseUrl : await databaseFor(databaseUrl, id));
    const at = await versionOf(db);
    await db.close();
    console.log(`${id}: at step ${at} of ${LATEST}`);
  }
}

if (import.meta.main) await deploy();
