// Loaded before every test file (npm test): what a test opened in memory is closed when it ends, so a file's
// databases do not pile up while it runs (a few hundred MB each). The steps it took are kept first, so no flush is
// left waiting to write to a database already closed, or to run while the process exits.
import { after, afterEach } from 'node:test';
import { openInMemory } from '../src/db.ts';
import { flushAll } from '../src/presence.ts';

afterEach(async () => {
  await flushAll().catch(() => {});
  for (const db of [...openInMemory]) await db.close();
});

// On Windows, Node 23 and later can crash at exit (libuv's "UV_HANDLE_CLOSING" in async.c) when the process is ended
// at once (--test-force-exit) while V8 still has work of its own pending, as it does after freeing a map's few
// hundred MB: a file whose every test passed is then failed (nodejs/node#56645). That work is given a moment first.
const SETTLE_MS = 200;
if (process.platform === 'win32') after(() => new Promise((done) => setTimeout(done, SETTLE_MS)));
