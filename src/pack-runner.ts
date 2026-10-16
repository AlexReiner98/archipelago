// What runs inside a pack's sandboxed process: it loads the pack's handler and speaks the host's protocol, one
// JSON object per line on standard input and output. Started by src/packhost.ts under node --permission, with an
// empty environment and read access to the pack's folder and this file only. It imports nothing.
//
// The handler is one ES module whose default export maps each entry (an action, a view) to a function of
// (input, context). The context says who is asking and when, and reads the map: `await ctx.read({ get: id })`.
// A function answers { ops, answer, reason } and the kernel does the writing; it throws to refuse.

import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

type Line = Record<string, unknown> & { id: number };
type Entry = (input: unknown, ctx: Record<string, unknown>) => unknown;

const send = (line: Record<string, unknown>) => process.stdout.write(JSON.stringify(line) + '\n');
const handler = (await import(pathToFileURL(process.argv[2]).href)).default as Record<string, Entry>;
const reads = new Map<number, (result: unknown, error?: string) => void>();
let next = 0;

async function run(call: Line) {
  const entry = handler?.[call.name as string];
  if (typeof entry !== 'function') return send({ id: call.id, error: `The handler has no "${call.name}".` });
  const ctx = {
    actor: call.actor,
    now: call.now,
    zone: call.zone,
    settings: call.settings ?? {},
    present: call.present ?? [],
    read: (query: Record<string, unknown>) =>
      new Promise((resolve, reject) => {
        const n = ++next;
        reads.set(n, (result, error) => (error ? reject(new Error(error)) : resolve(result)));
        send({ id: call.id, read: n, ...query });
      }),
  };
  try {
    const done = (await entry(call.input, ctx)) ?? {};
    send({ id: call.id, done });
  } catch (err) {
    send({ id: call.id, error: (err as Error).message ?? String(err) });
  }
}

for await (const text of createInterface({ input: process.stdin })) {
  const line = JSON.parse(text) as Line;
  if (typeof line.read === 'number') {
    reads.get(line.read)?.(line.result, line.error as string | undefined);
    reads.delete(line.read);
  } else void run(line);
}
