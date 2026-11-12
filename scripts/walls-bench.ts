// Bench the ways the page's parts could be walled from each other (decision e_xeqhcums, task e_u4anfue6 on the
// islands map): the same parts, drawn by the same code (scripts/walls-bench/part.js), in five modes of the host page
// (scripts/walls-bench/host.js), each in a fresh headless Chrome. Measures first draw, a keystroke to the part drawn
// again, every part drawn again (as a zoom does), pan frames, and Chrome's private memory (Windows), against a blank page.
//
//   node scripts/walls-bench.ts [runs=5] [counts=30,120] [packs=3]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { openBrowser } from '../packs/look_draw/kernel/chrome.ts';

const RUNS = Number(process.argv[2] ?? 5);
const COUNTS = (process.argv[3] ?? '30,120').split(',').map(Number);
const PACKS = Number(process.argv[4] ?? 3);
const MODES = ['none', 'frame', 'frames', 'workers'] as const;
const KEYS = 40, ZOOMS = 20, PAN = 120;

const DIR = join(import.meta.dirname, 'walls-bench');
const TYPES: Record<string, string> = { html: 'text/html', js: 'text/javascript' };
// Every file to any origin: the walled frames are of no origin, and fetch the bench's files across it.
const server = createServer((req, res) => {
  const name = new URL(req.url ?? '/', 'http://x').pathname.slice(1);
  if (!/^[\w-]+\.(html|js)$/.test(name)) return res.writeHead(404).end();
  try {
    res.writeHead(200, { 'content-type': TYPES[name.split('.')[1]], 'access-control-allow-origin': '*', 'cache-control': 'no-store' }).end(readFileSync(join(DIR, name)));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

/** Private bytes across the renderer processes of the bench's browser (its folder is named for this process): where a
 * page, its frames and their workers live. Chrome's other helpers come and go between runs, and only add noise. */
function chromeBytes(): { bytes: number; processes: number } | null {
  if (process.platform !== 'win32') return null;
  const script = `$p = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*pelago-look-${process.pid}-*' -and $_.CommandLine -like '*--type=renderer*' }; "$(($p | Measure-Object -Property PrivatePageCount -Sum).Sum) $(@($p).Count)"`;
  const [bytes, processes] = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim().split(' ').map(Number);
  return { bytes, processes };
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? NaN;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Run { first: number; key: number; keyP95: number; zoom: number; frame: number; long: number; mb?: number; processes?: number }

async function once(mode: string, n: number): Promise<Run> {
  const browser = await openBrowser();
  try {
    const tab = await browser.tab();
    await tab.send('Page.enable');
    await tab.send('Page.navigate', { url: `${origin}/host.html?mode=${mode}&n=${n}&packs=${PACKS}` });
    let first: number | null = null;
    for (let t = 0; t < 300 && first === null; t++) ((first = await tab.evaluate<number | null>('window.bench?.drawnAt ?? null').catch(() => null)), first === null && (await pause(50)));
    if (first === null) throw new Error(`${mode} ${n}: never drew`);
    await pause(1000);
    const memory = chromeBytes();
    const blank = mode === 'blank';
    const keys = blank ? [] : await tab.evaluate<number[]>(`(async () => { const out = []; for (let k = 0; k < ${KEYS}; k++) out.push(await bench.key(Math.floor(Math.random() * ${n}))); return out; })()`);
    const zooms = blank ? [] : await tab.evaluate<number[]>(`(async () => { const out = []; for (let k = 0; k < ${ZOOMS}; k++) out.push(await bench.zoom(1 + k / 10)); return out; })()`);
    const gaps = blank ? [] : await tab.evaluate<number[]>(`bench.pan(${PAN})`);
    await tab.close();
    return { first, key: median(keys), keyP95: p95(keys), zoom: median(zooms), frame: median(gaps), long: gaps.filter((g) => g > 20).length, mb: memory ? memory.bytes / 2 ** 20 : undefined, processes: memory?.processes };
  } finally {
    browser.close();
    await browser.closed;
    await pause(1500);
  }
}

const fmt = (x: number | undefined, d = 1) => (x === undefined || Number.isNaN(x) ? '-' : x.toFixed(d));
const results: Record<string, unknown>[] = [];
for (const n of COUNTS) {
  const blank: Run[] = [];
  for (let r = 0; r < RUNS; r++) blank.push(await once('blank', n));
  const base = median(blank.map((b) => b.mb ?? NaN));
  console.log(`\n${n} parts, ${PACKS} pack versions, median of ${RUNS} runs (blank page: ${fmt(base, 0)} MB, ${blank[0].processes} processes)`);
  console.log('mode     first draw ms  key ms (p95)   redraw all ms  pan frame ms (long)  memory over blank MB  processes');
  for (const mode of MODES) {
    const runs: Run[] = [];
    for (let r = 0; r < RUNS; r++) runs.push(await once(mode, n));
    const row = { n, mode, first: median(runs.map((r) => r.first)), key: median(runs.map((r) => r.key)), keyP95: median(runs.map((r) => r.keyP95)), zoom: median(runs.map((r) => r.zoom)), frame: median(runs.map((r) => r.frame)), long: median(runs.map((r) => r.long)), mb: median(runs.map((r) => r.mb ?? NaN)) - base, processes: runs[0].processes };
    results.push(row);
    console.log(`${mode.padEnd(8)} ${fmt(row.first).padStart(13)}  ${`${fmt(row.key, 2)} (${fmt(row.keyP95, 2)})`.padStart(13)}  ${fmt(row.zoom).padStart(13)}  ${`${fmt(row.frame)} (${row.long})`.padStart(19)}  ${fmt(row.mb, 0).padStart(20)}  ${String(row.processes ?? '-').padStart(9)}`);
  }
}
console.log(`\n${JSON.stringify(results)}`);
server.close();
