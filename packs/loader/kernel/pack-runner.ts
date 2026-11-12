// What runs inside a pack's sandboxed process: it loads the pack's handler and speaks the host's protocol, one
// JSON object per line on standard input and output. Started by src/packhost.ts under node --permission, with an
// empty environment and read access to the pack's folder and this file only. It imports nothing.
//
// The handler is one ES module whose default export maps each entry (an action, a view) to a function of
// (input, context). The context says who is asking and when, and reads the map: `await ctx.read({ get: id })`.
// A function answers { ops, answer, reason } and the kernel does the writing; it throws to refuse.
//
// Node 24 has no wall for the network, so this file puts one up before the handler loads, as the drawing runner
// does (src/drawing-runner.ts): a module may import only files of the handler's own folder and the node: built-ins
// that reach nothing outside it (no net, http, dns, child_process, worker, vm or module; no package, no data: or
// http: URL), and what reaches the network or the process (fetch, WebSocket, process and with it process.binding)
// is gone from its globals. What a pack may ask of its hosts it asks the kernel (`ctx.request`), past the server's walls.

import { registerHooks } from 'node:module';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

type Line = Record<string, unknown> & { id: number };
type Entry = (input: unknown, ctx: Record<string, unknown>) => unknown;

// What of the process the runner itself keeps, taken before the handler can see anything.
const stdout = process.stdout;
const stdin = process.stdin;
const entryUrl = pathToFileURL(process.argv[2]).href;
const folder = entryUrl.slice(0, entryUrl.lastIndexOf('/') + 1);

/** The built-ins a handler may import: none reaches the network, a process, a worker or the module loader. */
const BUILTINS = new Set(
  ['assert', 'assert/strict', 'buffer', 'crypto', 'events', 'fs', 'fs/promises', 'path', 'path/posix', 'path/win32', 'querystring', 'stream', 'stream/promises', 'stream/web', 'string_decoder', 'timers', 'timers/promises', 'url', 'util', 'util/types', 'zlib'].map((name) => `node:${name}`),
);
registerHooks({
  resolve(specifier, context, next) {
    const builtin = specifier.startsWith('node:') ? specifier : `node:${specifier}`;
    if (BUILTINS.has(builtin)) return next(builtin, context);
    const url = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/') || specifier.startsWith('file:') ? new URL(specifier, context.parentURL ?? entryUrl).href : '';
    if (!url.startsWith(folder)) throw new Error(`A pack's handler may import only its own modules and plain built-ins, not "${specifier}".`);
    return next(url, context);
  },
});

// Its globals, without a way out.
const g = globalThis as Record<string, unknown>;
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'Request', 'Response', 'Headers', 'FormData', 'navigator', 'process']) {
  try {
    Object.defineProperty(g, name, { value: undefined, configurable: false, writable: false });
  } catch {
    delete g[name];
  }
}

const send = (line: Record<string, unknown>) => stdout.write(JSON.stringify(line) + '\n');
const handler = (await import(entryUrl)).default as Record<string, Entry>;
const reads = new Map<number, (result: unknown, error?: string) => void>();
let next = 0;

/** Ask the kernel something during a call and wait for its answer: a read, or a server pack's act or store. */
const ask = (id: number, query: Record<string, unknown>) =>
  new Promise((resolve, reject) => {
    const n = ++next;
    reads.set(n, (result, error) => (error ? reject(new Error(error)) : resolve(result)));
    send({ id, read: n, ...query });
  });

async function run(call: Line) {
  const entry = handler?.[call.name as string];
  if (typeof entry !== 'function') return send({ id: call.id, error: `The handler has no "${call.name}".` });
  const ctx = {
    actor: call.actor,
    now: call.now,
    zone: call.zone,
    settings: call.settings ?? {},
    present: call.present ?? [],
    read: (query: Record<string, unknown>) => ask(call.id, query),
    // A server pack's: the address its server is reached at and where each of its hosts is, what it asks the kernel
    // to do (only the acts it declared), a request to a host it declared, made by the kernel, and the keys it keeps.
    origin: call.origin,
    hosts: call.hosts ?? {},
    act: (name: string, input: unknown) => ask(call.id, { act: name, input }),
    request: (request: Record<string, unknown>) => ask(call.id, { request }),
    store: {
      get: (key: string) => ask(call.id, { store: 'get', key }),
      put: (key: string, value: unknown, ms?: number) => ask(call.id, { store: 'put', key, value, ms }),
      take: (key: string) => ask(call.id, { store: 'take', key }),
      list: (prefix: string, most?: number) => ask(call.id, { store: 'list', prefix, most }),
    },
  };
  try {
    const done = (await entry(call.input, ctx)) ?? {};
    send({ id: call.id, done });
  } catch (err) {
    send({ id: call.id, error: (err as Error).message ?? String(err) });
  }
}

send({ ready: true }); // the host starts a call's clock from here: starting the process is not the handler's time

for await (const text of createInterface({ input: stdin })) {
  const line = JSON.parse(text) as Line;
  if (typeof line.read === 'number') {
    reads.get(line.read)?.(line.result, line.error as string | undefined);
    reads.delete(line.read);
  } else void run(line);
}
