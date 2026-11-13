// What runs inside the process a part's frozen marks are made in (./part-box.ts, which spawns it by its path here;
// nothing else does), as ./drawing-runner.ts runs a drawing's first frame: under node --permission with an empty
// environment and read access to the part's folder and this file only, a module importing only files of its own
// folder, and nothing that reaches the network or the process left in its globals. It reads one JSON line (the part's
// entry and what the page would hand it), calls the part once, answers one line (its marks, its page's title, and the
// marks of each item it would open beside the page), and is stopped. It imports nothing of the kernel.

import { registerHooks } from 'node:module';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

type Asked = { entry: string; input: unknown };
type Drawn = { marks?: unknown; title?: unknown; sheets?: unknown } | undefined;

const out = process.stdout;
const send = (line: Record<string, unknown>) => out.write(JSON.stringify(line) + '\n');
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

const asked = await new Promise<Asked>((resolve) => {
  const lines = createInterface({ input: process.stdin });
  lines.once('line', (text) => (lines.close(), resolve(JSON.parse(text) as Asked)));
});

const entry = pathToFileURL(asked.entry).href;
const folder = entry.slice(0, entry.lastIndexOf('/') + 1);
registerHooks({
  resolve(specifier, context, next) {
    const url = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('file:') ? new URL(specifier, context.parentURL ?? entry).href : '';
    if (!url.startsWith(folder) || !url.endsWith('.js')) throw new Error(`A part may import only its own modules, not "${specifier}".`);
    return next(url, context);
  },
});

const g = globalThis as Record<string, unknown>;
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'Request', 'Response', 'Headers', 'FormData', 'navigator', 'process']) {
  try {
    Object.defineProperty(g, name, { value: undefined, configurable: false, writable: false });
  } catch {
    delete g[name];
  }
}

try {
  const made = (await import(entry)) as { default: (input: unknown) => Drawn | Promise<Drawn> };
  const drawn = await made.default(asked.input);
  send({ drawn: { marks: plain(drawn?.marks), ...(typeof drawn?.title === 'string' && { title: drawn.title }), ...(drawn?.sheets && { sheets: plain(drawn.sheets) }) } });
} catch (err) {
  send({ error: (err as Error)?.message ?? String(err) });
}
