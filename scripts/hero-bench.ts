// How soon the landing page's hero is on screen, against its text, in a real browser over a slowed network:
//   node scripts/hero-bench.ts [page.json | https://archipelago.tools/] [runs]
// Given a page's data (what https://archipelago.tools/data answers), it is published on a server of its own, here,
// as this checkout would publish it, and read there; given an address, that page is read as it is.
// For each visit: first contentful paint, the page's text, the hero's first frame and its first drawn step, from
// navigation, with the network slowed to a round trip of LATENCY ms. A fresh visit is a browser with nothing kept;
// a repeat one opens the page again in the same browser.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { createSecureServer } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../test/browser.ts';

const [source = 'https://archipelago.tools/', runs = '5'] = process.argv.slice(2);
const LATENCY = Number(process.env.LATENCY ?? 50);
const HERO = process.env.HERO ?? 'e_dbnx3zwr';

/** A server of its own, its default workspace holding the page as published from the data given. */
async function local(file: string) {
  const { createHttpServer } = await import('../src/server.ts');
  const { Workspaces } = await import('../src/workspaces.ts');
  const root = join(import.meta.dirname, '..');
  const workspaces = new Workspaces({ dataDir: null, rootDir: mkdtempSync(join(tmpdir(), 'pelago-bench-')), packsDir: join(root, 'packs') });
  const probe = createHttpServer(workspaces, 0);
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const server = createHttpServer(workspaces, port, { auth: 'off' });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${port}`;
  const call = async (tool: string, body: unknown) => (await (await fetch(`${base}/api/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as any;
  const id = (await call('change', { reason: 'bench', ops: [{ op: 'create', ref: 'd', type: 'work.document', title: 'Home', visibility: 'shared', body: 'Home.' }] })).result.created.d;
  await call('publish', { id });
  // What was published there, as this checkout publishes it: the frozen pictures kept with what it adds at publish.
  const live = JSON.parse(readFileSync(file, 'utf8'));
  const { theme: _t, lengths: _l, site: _s, published_at: _p, ...given } = live;
  const pelago = (await workspaces.get('default')).pelago;
  // Drawn by this checkout's drawings, as a page published here now would be.
  const { drawingFor } = await import('../src/drawings.ts');
  for (const lens of Object.values(given.lenses ?? {}) as { style: Record<string, unknown> }[]) if (lens.style.drawing) lens.style.drawing = drawingFor(pelago.registry, { shape: lens.style.shape }, []);
  const atPublish = await import('../src/published-frames.ts').catch(() => null);
  if (atPublish) await atPublish.framesFor(pelago, given.lenses);
  await pelago.db.query(`update published set given = $1::jsonb where entity_id = $2`, [JSON.stringify({ ...given, id }), id]);
  // Read over HTTP/2, as the live site is (its proxy speaks it): every file in one connection, none waiting for another.
  const dir = mkdtempSync(join(tmpdir(), 'pelago-bench-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1'], { stdio: 'ignore' });
  const proxy = createSecureServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')), allowHTTP1: true }, (req, res) => {
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !k.startsWith(':') && k !== 'connection'));
    const out = request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: { ...headers, host: `127.0.0.1:${port}` } }, (back) => {
      const kept = Object.fromEntries(Object.entries(back.headers).filter(([k]) => !['connection', 'transfer-encoding', 'keep-alive'].includes(k)));
      res.writeHead(back.statusCode ?? 502, kept);
      back.pipe(res);
    });
    req.pipe(out);
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const at = `https://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  return { url: `${at}/p/default/${id}`, close: () => (proxy.close(), server.close(), workspaces.closeAll()) };
}

/** Set before the page's own scripts: when each thing was first on screen, from navigation. */
const watch = `(() => {
  const m = (window.__seen = {});
  new PerformanceObserver((l) => l.getEntries().forEach((e) => e.name === 'first-contentful-paint' && (m.fcp = e.startTime))).observe({ type: 'paint', buffered: true });
  const when = (name, test) => { if (m[name] === undefined && test()) { m[name] = null; requestAnimationFrame(() => (m[name] = performance.now())); } };
  const look = () => {
    when('text', () => document.querySelector('main h1, main .text p'));
    const hero = document.querySelector('[data-lens="${HERO}"]');
    when('frame', () => hero?.querySelector('svg'));
    when('drawn', () => hero?.querySelector('svg a.ar-part:not(.sp-off), svg a.ar-part[opacity="1"]'));
  };
  new MutationObserver(look).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['opacity', 'class'] });
})()`;

async function visit(page: Awaited<ReturnType<typeof open>>, url: string) {
  await page.go(url);
  for (let n = 0; n < 200; n++) {
    const seen = await page.evaluate<Record<string, number>>('window.__seen');
    if (seen?.frame && seen?.drawn && seen?.fcp && seen?.text) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const seen = await page.evaluate<Record<string, number>>('window.__seen');
  const files = await page.evaluate<{ name: string; start: number; end: number; size: number }[]>(
    `performance.getEntriesByType('resource').map((e) => ({ name: e.name.replace(location.origin, ''), start: Math.round(e.startTime), end: Math.round(e.responseEnd), size: e.transferSize }))`,
  );
  const html = await page.evaluate<number>(`Math.round(performance.getEntriesByType('navigation')[0].responseEnd)`);
  return { ...Object.fromEntries(Object.entries(seen ?? {}).map(([k, v]) => [k, Math.round(v)])), html, files };
}

const site = source.startsWith('http') ? { url: source, close: () => {} } : await local(source);
const fresh: any[] = [], again: any[] = [];
for (let n = 0; n < Number(runs); n++) {
  const page = await open('about:blank');
  await page.send('Security.setIgnoreCertificateErrors', { ignore: true });
  await page.send('Network.enable');
  await page.send('Network.emulateNetworkConditions', { offline: false, latency: LATENCY, downloadThroughput: 2.5e6, uploadThroughput: 1e6 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: watch });
  fresh.push(await visit(page, site.url));
  // SHOT=<file prefix>: the page as it opened, and once the story has played a while.
  if (process.env.SHOT && n === 0) {
    const { writeFileSync } = await import('node:fs');
    await page.go(site.url);
    writeFileSync(`${process.env.SHOT}-opened.png`, await page.screenshot());
    await new Promise((r) => setTimeout(r, 9000));
    writeFileSync(`${process.env.SHOT}-played.png`, await page.screenshot());
  }
  again.push(await visit(page, site.url));
  page.close();
}
const median = (list: any[], key: string) => list.map((r) => r[key]).filter((v) => typeof v === 'number').sort((a, b) => a - b)[Math.floor(list.length / 2)];
for (const [name, list] of [['fresh', fresh], ['repeat', again]] as const) {
  const [fcp, text, frame, drawn, html] = ['fcp', 'text', 'frame', 'drawn', 'html'].map((k) => median(list, k));
  console.log(`${name.padEnd(6)} html ${html} | fcp ${fcp} | text ${text} | hero frame ${frame} (fcp +${frame - fcp}) | first step drawn ${drawn}`);
}
if (process.env.FILES) for (const f of fresh[0].files) console.log(`  ${String(f.start).padStart(5)}–${String(f.end).padEnd(5)} ${String(f.size).padStart(7)}  ${f.name}`);
await site.close();
process.exit(0);
