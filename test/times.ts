// A reporter for node --test: the seconds each file's tests took, as JSON ({ "test/a.test.ts": 3.2, ... }), the sum of
// its top-level tests (a suite's time holds its tests'). CI writes one per shard (scripts/test.ts, PELAGO_TEST_TIMES)
// and scripts/test-weights.ts ci makes test/weights.json from them.
import { relative } from 'node:path';

type Event = { type: string; data: { file?: string; nesting?: number; details?: { duration_ms?: number } } };

export default async function* times(source: AsyncIterable<Event>) {
  const seconds: Record<string, number> = {};
  for await (const { type, data } of source) {
    if ((type !== 'test:pass' && type !== 'test:fail') || data.nesting !== 0 || !data.file) continue;
    const file = relative(process.cwd(), data.file).replaceAll('\\', '/');
    seconds[file] = (seconds[file] ?? 0) + (data.details?.duration_ms ?? 0) / 1000;
  }
  yield `${JSON.stringify(Object.fromEntries(Object.entries(seconds).map(([f, s]) => [f, Math.round(s * 10) / 10])), null, 1)}\n`;
}
