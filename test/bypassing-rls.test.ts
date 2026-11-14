// Who may read a map with row-level security bypassed. bypassingRls (packs/identity/kernel/outbox.ts) hands back the whole map, not the
// viewer's, and a Db's `whole` is the same database without the viewer's role; each skips the policies packs/database/kernel/db.ts sets.
// Every file that reaches past them is listed here with how many times, as it stood on 12 Nov 2026 (bug e_qeyv9c3u):
// a new caller, or another call in a listed file, is a change someone reviews by adding it here. An entry may only
// shrink, as the lists in test/structure.test.ts do: when a call goes, lower its number in the same commit.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { read, walk } from './structure-kit.ts'; // every module is counted at its own place

const files = ['src', 'packs'].flatMap(walk).filter((f) => /\.(ts|js|mjs)$/.test(f));
const count = (pattern: RegExp) =>
  Object.fromEntries(files.map((f) => [f, read(f).match(pattern)?.length ?? 0]).filter(([, n]) => (n as number) > 0));

/** Calls of bypassingRls, each file's count. */
const CALLERS: Record<string, number> = {
  'packs/surface/kernel/backup-tools.ts': 1,
  'packs/identity/kernel/members.ts': 4,
  'packs/identity/kernel/guest-keep.ts': 1, // keeping a guest map: the member row for the signing-in email and the system's tick of the plan's sign-in step, as members.ts signs a person in (approved by Alex, 14 Nov 2026, PR #387)
  'packs/walls/kernel/notify-mail.ts': 2,
  'packs/loader/kernel/pack-launch.ts': 1,
  'packs/write/kernel/root-notify.ts': 1, // root.notify: who a notification made by the system is for, the workspace's owner, read whole as packs/notifications/kernel/notify.ts read it
  'packs/surface/kernel/root-looks.ts': 1, // root.look: a look pass is kept in the whole workspace's transient store, as passFor's callers kept it
  'packs/surface/kernel/root-sessions.ts': 1, // root.sessions: the sessions at work and the reply rules' settings, the whole workspace's, as packs/sessions/kernel/chat-run.ts and the hook's whole database read them (wave 6b: those six bypasses in sessions' modules went)
  'packs/surface/kernel/root-transient.ts': 1, // root.transient: the store only the whole database reaches, for the packs roots.json lets keep there
  'packs/identity/kernel/token-tools.ts': 1,
  'packs/surface/kernel/tool-human.ts': 1, // import_backup: everything in the file goes in, whoever it is private to
  'packs/surface/kernel/tool-reads.ts': 1,
  'packs/loader/kernel/typetable.ts': 2,
  'packs/surface/kernel/workspace-tools.ts': 4, // root.counters, the usage view's whole count (was packs/usage/kernel/usage.ts's)
};

/** Reads of a Db's `whole`: packs/database/kernel/db.ts carries it through, and the type table's own bypassingRls takes it. */
const WHOLE_DB: Record<string, number> = { 'packs/database/kernel/db.ts': 1, 'packs/loader/kernel/typetable.ts': 2 };

const over = (counted: Record<string, number>, frozen: Record<string, number>) => [
  ...Object.entries(counted).filter(([f, n]) => n > (frozen[f] ?? 0)).map(([f, n]) => `${f}: ${n}, over ${frozen[f] ?? 0}`),
  ...Object.entries(frozen).filter(([f, n]) => (counted[f] ?? 0) < n).map(([f, n]) => `${f}: ${counted[f] ?? 0} now: lower its entry from ${n}`),
];

test('every read past row-level security is listed', () => {
  assert.deepEqual(over(count(/(?<!function )\bbypassingRls\(/g), CALLERS), [], 'Read as the viewer (l.db) where you can; a new bypassingRls caller is added to CALLERS for review.');
  assert.deepEqual(over(count(/\bdb\.whole\b/g), WHOLE_DB), [], 'Reach the whole map through bypassingRls, listed in CALLERS, not through a Db\'s whole.');
});
