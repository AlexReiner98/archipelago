// How long the flow drawing takes on a real answer, in headless Chrome, behind the sandbox as the page draws it:
//   node scripts/flow-bench.ts <answer.json> [http://127.0.0.1:3100] [runs] [--png <file>]
// The answer is what query flat answers (its `result`, or the answer itself), saved to a file. Each run is a fresh
// page: the time from asking for the picture until it is drawn, or the message it stopped with. With --png, the last
// run's picture, fitted to the page, is kept as that file.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open } from '../test/browser.ts';
import { house } from '../test/layout-cases.ts';
import { layoutFor } from '../src/layouts.ts';

const args = process.argv.slice(2), png = args.includes('--png') ? args.splice(args.indexOf('--png'), 2)[1] : null;
const [file, base = 'http://127.0.0.1:3100', runs = '3'] = args;
if (!file) throw new Error('Name the answer: node scripts/flow-bench.ts <answer.json>');
const root = process.env.FLOW_ROOT ?? join(import.meta.dirname, '..');
const given = JSON.parse(readFileSync(file, 'utf8'));
const answer = given.result ?? given;
const drawing = layoutFor({ folderOf: (p: string) => join(root, 'packs', p), packs: [JSON.parse(readFileSync(join(root, 'packs', 'core', 'pack.json'), 'utf8'))] }, { shape: 'flow' }, []);
const plain = house('flow'), style = { ...plain, ...(process.env.FLOW_WORK && { sizes: { ...plain.sizes, flow_picture_work: Number(process.env.FLOW_WORK) } }), noLit: true, drawing };

const bench = `async (answer, style) => {
  const { drawWith } = await import('/layout.js');
  const host = document.createElement('div');
  host.className = 'lens-view';
  host.style.cssText = 'position:fixed;inset:0;z-index:9;background:var(--bg)';
  document.body.append(host);
  const t0 = performance.now();
  drawWith(host, answer, style, () => {});
  await new Promise((resolve) => { const done = () => (host.moves || host.querySelector('.lens-error')) && (seen.disconnect(), resolve(), true); const seen = new MutationObserver(done); if (!done()) seen.observe(host, { childList: true, subtree: true }); });
  host.moves?.fit();
  return { ms: Math.round(performance.now() - t0), stopped: host.querySelector('.lens-error')?.textContent ?? null, marks: host.querySelectorAll('svg *').length, hash: [...(host.querySelector('.lf-stage svg')?.outerHTML ?? '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) };
}`;

for (let n = 0; n < Number(runs); n++) {
  const page = await open(`${base}/`);
  console.log(JSON.stringify(await page.evaluate(`(${bench})(${JSON.stringify(answer)}, ${JSON.stringify(style)})`)));
  if (png && n === Number(runs) - 1) writeFileSync(png, await page.screenshot());
  page.close();
}
process.exit(0);
