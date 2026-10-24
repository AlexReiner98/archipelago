import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { Archipelago } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { make } from './map.ts';

test('a database made while this was called Lattice is opened under the new names, with nothing lost', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-before-'));
  const made = await openDb(dir);
  // As it stood then: no record of schema steps, the two roles with what they were granted, a function of that name, and events said to be Lattice's own.
  await made.exec(`
    drop table schema_version;
    create role lattice_member nologin; grant select, insert, update on entity, event to lattice_member;
    create role lattice_public nologin; grant select (id, title) on entity to lattice_public;
    create function lattice_is_public(target text) returns boolean language sql stable as $fn$ select false $fn$;
    grant execute on function lattice_is_public(text) to lattice_public;
    insert into event (origin, actor, action) values ('lattice', 'agent:lattice', 'run.stale'), ('github', 'github:push', 'push');
  `);
  await made.close();
  const db = await openDb(dir);
  assert.deepEqual((await db.query<{ rolname: string }>(`select rolname from pg_roles where rolname like 'lattice%' or rolname like 'pelago%' order by 1`)).rows.map((r) => r.rolname), ['pelago_compactor', 'pelago_member', 'pelago_public']);
  assert.deepEqual((await db.query<{ proname: string }>(`select proname from pg_proc where proname like 'lattice%'`)).rows, []);
  assert.deepEqual((await db.query<{ origin: string }>(`select origin from event order by seq`)).rows.map((r) => r.origin), ['pelago', 'github']);
  // And a member still sees through the role that took the old one's place.
  const packs = mkdtempSync(join(tmpdir(), 'pelago-packs-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  const l = new Archipelago(db, new Registry(packs));
  await make(l, [{ op: 'create', type: 'work.task', title: 'Seen after the move' }]);
  assert.equal((await l.as('nobody').db.query(`select 1 from entity where title = 'Seen after the move'`)).rows.length, 1);
  await db.close();
});
