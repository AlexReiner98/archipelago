/**
 * The dev server for the browser runtime: serves the repository's files,
 * TypeScript with its types stripped (the same source runs on Node and in
 * the browser, no build), and pushes changes for HMR.
 *
 * Each module it serves has its relative imports rewritten to carry the
 * target's version (`./word.ts?v=2`), and its imports recorded in the
 * module graph. When a file changes, the change and every module that
 * imports it get new versions (Algorithm 8), and `/@hmr` tells every page
 * which modules were accepted, at what version. The page's loader then
 * re-imports the entries built on them. `/` sends the browser to the app,
 * `/app/`.
 *
 *   node runtime/serve.ts [port] [root]
 */
import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { refuse, type LocalAccess } from "./guard.ts";
import { ModuleGraph } from "./hmr.ts";

const TYPES: Record<string, string> = {
  ".ts": "text/javascript",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Imports and re-exports with a relative or rooted specifier. */
const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']+|\/[^"']+)\2/g;

/** The runtime's own modules: a change to one needs a reload of the page. */
const declined = (path: string) => path.startsWith("/runtime/");

export interface DevServer {
  url: string;
  graph: ModuleGraph;
  close(): Promise<void>;
}

/**
 * `hosts` and `origins` add to what the guard answers (guard.ts). `files`
 * is a folder served as is at `/files/` (the data's pictures a note shows),
 * read only, nothing outside it. `bridge` is the bridge's port: the page
 * asks `/bridge/caps` first (app/boot.ts), and is told `{ at }`, the
 * bridge's address on the host it asked, instead of a 404.
 */
export async function serve(options: { port?: number; root?: string; watch?: boolean; files?: string; bridge?: number } & LocalAccess = {}): Promise<DevServer> {
  const root = resolve(options.root ?? join(fileURLToPath(import.meta.url), "../.."));
  const files = options.files && resolve(options.files);
  const graph = new ModuleGraph();
  const clients = new Set<ServerResponse>();

  /** Rewrites a module's imports to their versions, recording them. */
  const rewrite = (path: string, code: string) => {
    const deps = new Set<string>();
    const out = code.replace(IMPORT, (_m, lead: string, q: string, spec: string) => {
      const target = new URL(spec, `http://x${path}`).pathname;
      deps.add(target);
      return `${lead}${q}${graph.versioned(target)}${q}`;
    });
    graph.setImports(path, deps);
    return out;
  };

  const access: LocalAccess = { hosts: options.hosts, origins: options.origins };
  const server = createServer(async (req, res) => {
    if (refuse(req, res, access)) return;
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/@hmr") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(": hmr\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (url.pathname === "/") {
      res.writeHead(302, { location: "/app/" }).end();
      return;
    }
    if (options.bridge && url.pathname === "/bridge/caps") {
      // The guard has checked the host: the bridge is on the same one, at its own port.
      const at = `http://${new URL(`http://${req.headers.host}`).hostname}:${options.bridge}/`;
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ at }));
      return;
    }
    let path = decodeURIComponent(url.pathname);
    if (files && path.startsWith("/files/")) {
      const file = join(files, path.slice("/files/".length));
      const ext = extname(file).toLowerCase();
      // Only a file inside the folder, a raster image: an SVG opened on its own runs script.
      if (!file.startsWith(files + sep) || !TYPES[ext]?.startsWith("image/") || ext === ".svg") {
        res.writeHead(403).end();
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": TYPES[ext]!, "cache-control": "no-store", "x-content-type-options": "nosniff" });
        res.end(body);
      } catch {
        res.writeHead(404).end(`not found: ${path}`);
      }
      return;
    }
    let file = join(root, path);
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) {
        path = path.replace(/\/?$/, "/index.html");
        file = join(file, "index.html");
      }
      let body: string | Buffer = await readFile(file);
      const ext = extname(file);
      if (ext === ".ts" || ext === ".js") {
        let code = body.toString("utf8");
        if (ext === ".ts") code = stripTypeScriptTypes(code, { mode: "strip" });
        body = rewrite(path, code);
      }
      res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404).end(`not found: ${path}`);
    }
  });

  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = options.watch === false ? undefined : watch(root, { recursive: true }, (_e, name) => {
    if (!name || name.includes("node_modules") || name.startsWith(".git")) return;
    pending.add("/" + name.replaceAll("\\", "/"));
    clearTimeout(timer);
    timer = setTimeout(() => {
      const changed = [...pending].filter((p) => graph.has(p));
      pending = new Set();
      if (!changed.length) return;
      const { accepted, declined: restart } = graph.classify(changed, declined);
      graph.bump(accepted);
      const versions = Object.fromEntries([...accepted].map((p) => [p, graph.version(p)]));
      const data = JSON.stringify({ accepted: [...accepted], versions, restart: [...restart] });
      for (const c of clients) c.write(`data: ${data}\n\n`);
    }, 50);
  });

  await new Promise<void>((ok) => server.listen(options.port ?? 0, "127.0.0.1", ok));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    url: `http://127.0.0.1:${port}/`,
    graph,
    close: async () => {
      watcher?.close();
      for (const c of clients) c.end();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? 5180);
  const s = await serve({ port, root: process.argv[3] });
  console.log(`serving ${s.url}`);
}
