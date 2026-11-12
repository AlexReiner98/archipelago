// What runs inside the process a drawing's first frame is made in (./drawing-box.ts, which spawns it by its path here; nothing else does): started under node
// --permission with an empty environment and read access to the drawing's folder and this file only, so its code
// writes no file, starts no process or worker and reads nothing of the server's. Node 24 has no wall for the network,
// so this file puts one up before the drawing loads: a module may import only files of its own folder (no node:
// module, no package, no data: or http: URL), and what reaches the network or the process (fetch, WebSocket,
// process.getBuiltinModule) is gone from its globals. It reads one JSON line, answers one, and is stopped.
// It imports nothing of the kernel.

import { registerHooks } from 'node:module';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

type Asked = { entry: string; input: unknown; widths: Record<string, number>; other: number };

const out = process.stdout;
const send = (line: Record<string, unknown>) => out.write(JSON.stringify(line) + '\n');
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

const asked = await new Promise<Asked>((resolve) => {
  const lines = createInterface({ input: process.stdin });
  lines.once('line', (text) => (lines.close(), resolve(JSON.parse(text) as Asked)));
});

// The drawing's folder, as a URL every module it loads must be inside.
const entry = pathToFileURL(asked.entry).href;
const folder = entry.slice(0, entry.lastIndexOf('/') + 1);
registerHooks({
  resolve(specifier, context, next) {
    const url = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('file:') ? new URL(specifier, context.parentURL ?? entry).href : '';
    if (!url.startsWith(folder) || !url.endsWith('.js')) throw new Error(`A drawing may import only its own modules, not "${specifier}".`);
    return next(url, context);
  },
});

// Its globals, without a way out. Only what the runner kept before this reaches the outside.
const g = globalThis as Record<string, unknown>;
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'Request', 'Response', 'Headers', 'FormData', 'navigator', 'process']) {
  try {
    Object.defineProperty(g, name, { value: undefined, configurable: false, writable: false });
  } catch {
    delete g[name];
  }
}

const measure = (text: string, px: number) => ([...String(text)].reduce((w, ch) => w + (asked.widths[ch] ?? asked.other), 0) * px) / 100;
try {
  const { picture } = (await import(entry)) as { picture: (input: unknown, ctx: unknown) => { scene?: unknown; end?: () => void } | undefined };
  const drawn = picture(asked.input, { measure, patch: () => {}, open: () => {}, frame: () => new Promise(() => {}) });
  // What plays after the first frame is the reader's: stopped before it starts.
  drawn?.end?.();
  send({ scene: drawn?.scene ? plain(drawn.scene) : null });
} catch (err) {
  send({ error: (err as Error)?.message ?? String(err) });
}
