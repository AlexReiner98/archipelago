// Serves this folder, for looking at the sketch: node sketches/serve.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// The sketches folder, so each sketch is at its own path: /ridges/.
const here = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const port = Number(process.env.PORT ?? 3210);

createServer(async (req, res) => {
  let name = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
  if (!name || /[\\/]$/.test(name)) name += 'index.html';
  if (name === 'index.html') return res.writeHead(302, { location: '/ridges/' }).end();
  if (name.startsWith('..')) return res.writeHead(403).end();
  try {
    const body = await readFile(join(here, name));
    res.writeHead(200, { 'content-type': types[extname(name)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`patterns on http://127.0.0.1:${port}`));
