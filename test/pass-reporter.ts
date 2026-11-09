// A reporter for node --test: which files passed whole, as JSON ({ "test/a.test.ts": true, ... }), from the summary
// node gives as each file's process ends (as test/times.ts reads it). scripts/test.ts keeps those passes
// (test/passes.ts) so the next run of a set skips them while their code is the same.
import { relative } from 'node:path';

type Event = { type: string; data: { file?: string; success?: boolean; counts?: { tests?: number; failed?: number; cancelled?: number; todo?: number } } };

export default async function* passes(source: AsyncIterable<Event>) {
  const ok: Record<string, boolean> = {};
  for await (const { type, data } of source) {
    if (type !== 'test:summary' || !data.file) continue;
    const file = relative(process.cwd(), data.file).replaceAll('\\', '/');
    const c = data.counts ?? {};
    // A file with a test left to do did not pass whole: it runs again. One skipped where it cannot run (Postgres
    // only, say) skips the same way next time.
    ok[file] = (ok[file] ?? true) && data.success === true && !c.failed && !c.cancelled && !c.todo && (c.tests ?? 0) > 0;
  }
  yield `${JSON.stringify(ok)}\n`;
}
