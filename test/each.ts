// Loaded before every test file (npm test): what a test opened in memory is closed when it ends, so a file's
// databases do not pile up while it runs (a few hundred MB each).
import { afterEach } from 'node:test';
import { openInMemory } from '../src/db.ts';

afterEach(async () => {
  for (const db of [...openInMemory]) await db.close();
});
