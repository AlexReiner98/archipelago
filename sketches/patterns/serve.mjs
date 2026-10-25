// Serves this folder, for looking at the sketch: node sketches/patterns/serve.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const port = Number(process.env.PORT ?? 3210);

createServer(async (req, res) => {
  const name = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '') || 'index.html';
  if (name.startsWith('..')) return res.writeHead(403).end();
  try {
    const body = await readFile(join(here, name));
    res.writeHead(200, { 'content-type': types[extname(name)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`patterns on http://127.0.0.1:${port}`));
