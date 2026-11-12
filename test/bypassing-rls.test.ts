// Who may read a map with row-level security bypassed. bypassingRls (src/outbox.ts) hands back the whole map, not the
// viewer's, and a Db's `whole` is the same database without the viewer's role; each skips the policies src/db.ts sets.
// Every file that reaches past them is listed here with how many times, as it stood on 12 Nov 2026 (bug e_qeyv9c3u):
// a new caller, or another call in a listed file, is a change someone reviews by adding it here. An entry may only
// shrink, as the lists in test/structure.test.ts do: when a call goes, lower its number in the same commit.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { read, walk } from './structure-kit.ts'; // every module is counted at its own place

const files = ['src', 'ui', 'packs'].flatMap(walk).filter((f) => /\.(ts|js|mjs)$/.test(f));
const count = (pattern: RegExp) =>
  Object.fromEntries(files.map((f) => [f, read(f).match(pattern)?.length ?? 0]).filter(([, n]) => (n as number) > 0));

/** Calls of bypassingRls, each file's count. */
const CALLERS: Record<string, number> = {
  'src/backup-tools.ts': 1,
  'src/members.ts': 4,
  'src/notify-mail.ts': 2,
  'src/pack-launch.ts': 1,
  'packs/write/kernel/root-notify.ts': 1, // root.notify: who a notification made by the system is for, the workspace's owner, read whole as src/notify.ts read it
  'packs/surface/kernel/root-looks.ts': 1, // root.look: a look pass is kept in the whole workspace's transient store, as passFor's callers kept it
  'packs/surface/kernel/root-sessions.ts': 1, // root.sessions: the sessions at work and the reply rules' settings, the whole workspace's, as src/chat-run.ts and the hook's whole database read them (wave 6b: those six bypasses in sessions' modules went)
  'packs/surface/kernel/root-transient.ts': 1, // root.transient: the store only the whole database reaches, for the packs roots.json lets keep there
  'src/token-tools.ts': 1,
  'src/tool-human.ts': 1, // import_backup: everything in the file goes in, whoever it is private to
  'src/tool-reads.ts': 1,
  'src/typetable.ts': 2,
  'src/workspace-tools.ts': 4, // root.counters, the usage view's whole count (was src/usage.ts's)
};

/** Reads of a Db's `whole`: src/db.ts carries it through, and the type table's own bypassingRls takes it. */
const WHOLE_DB: Record<string, number> = { 'src/db.ts': 1, 'src/typetable.ts': 2 };

const over = (counted: Record<string, number>, frozen: Record<string, number>) => [
  ...Object.entries(counted).filter(([f, n]) => n > (frozen[f] ?? 0)).map(([f, n]) => `${f}: ${n}, over ${frozen[f] ?? 0}`),
  ...Object.entries(frozen).filter(([f, n]) => (counted[f] ?? 0) < n).map(([f, n]) => `${f}: ${counted[f] ?? 0} now: lower its entry from ${n}`),
];

test('every read past row-level security is listed', () => {
  assert.deepEqual(over(count(/(?<!function )\bbypassingRls\(/g), CALLERS), [], 'Read as the viewer (l.db) where you can; a new bypassingRls caller is added to CALLERS for review.');
  assert.deepEqual(over(count(/\bdb\.whole\b/g), WHOLE_DB), [], 'Reach the whole map through bypassingRls, listed in CALLERS, not through a Db\'s whole.');
});
