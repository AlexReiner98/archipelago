// A reporter for node --test: the seconds each file took, as JSON ({ "test/a.test.ts": 3.2, ... }), from the summary
// node gives as each file's process ends. A test's own event names the file that called test(), which for a file
// that only calls a helper (test/approvals-dev-1.test.ts calls test/approvals.ts) is the helper; the summary names
// the file that ran. CI writes one per shard (scripts/test.ts, PELAGO_TEST_TIMES) and scripts/test-weights.ts ci
// makes test/weights.json from them.
import { relative } from 'node:path';

type Event = { type: string; data: { file?: string; duration_ms?: number } };

export default async function* times(source: AsyncIterable<Event>) {
  const seconds: Record<string, number> = {};
  for await (const { type, data } of source) {
    if (type !== 'test:summary' || !data.file) continue;
    const file = relative(process.cwd(), data.file).replaceAll('\\', '/');
    seconds[file] = (seconds[file] ?? 0) + (data.duration_ms ?? 0) / 1000;
  }
  yield `${JSON.stringify(Object.fromEntries(Object.entries(seconds).map(([f, s]) => [f, Math.round(s * 10) / 10])), null, 1)}\n`;
}
