// Whether a page stays still while the map changes under it: three agents write through /agent/change every second,
// two of them to items elsewhere and one to an item on the page, while one item's page is open in headless Chrome.
// Says whether the page reloaded, whether it moved from where the reader had scrolled, whether an open fold stayed
// open, and whether the change to the item on it showed in place. On a local server only; what it makes is archived.
//   node scripts/stable-page.ts <base> <item id> [seconds=30]

import { open } from '../test/browser.ts';

const [base = 'http://127.0.0.1:3116', page = '', seconds = '30'] = process.argv.slice(2);
if (!page) throw new Error('node scripts/stable-page.ts <base> <item id> [seconds]');
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(base)) throw new Error('A local server only: this writes to its map.');

const call = async (tool: string, body: Record<string, unknown>) => {
  const res = (await (await fetch(`${base}/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as { result?: any; error?: string };
  if (res.error) throw new Error(`${tool}: ${res.error}`);
  return res.result;
};
const change = (actor: string, reason: string, ops: unknown[]) => call('change', { actor, reason: `Test of a still page: ${reason}`, ops });

// One item on the page (part of it), and two elsewhere, in a project of their own.
const made = (
  await change('agent:stable-setup', 'what the writers change', [
    { op: 'create', ref: 'on', type: 'task', title: 'Still page: on it 0' },
    { op: 'link', type: 'part_of', from: 'on', to: page },
    { op: 'create', ref: 'away', type: 'project', title: 'Still page: elsewhere' },
    { op: 'create', ref: 'a', type: 'task', title: 'Still page: away a 0' },
    { op: 'create', ref: 'b', type: 'task', title: 'Still page: away b 0' },
    { op: 'link', type: 'part_of', from: 'a', to: 'away' },
    { op: 'link', type: 'part_of', from: 'b', to: 'away' },
  ])
).created as Record<string, string>;

const chrome = await open('about:blank');
await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await chrome.go(`${base}/#/e/${page}`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (expression: string, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(200)) if (await chrome.evaluate(expression)) return true;
  return false;
};
await until(`document.querySelector('.part[data-part="item"] h1') && !document.querySelector('.lens-view .empty')`);
await wait(3000);
// The reader: following agents left off, scrolled part way down, the history opened, and a mark that a reload would lose.
const reader = await chrome.evaluate<{ y: number; history: boolean }>(`(() => {
  window.stillMark = 1;
  window.redraws = 0;
  window.swapped = {};
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) (window.redraws += 1), (window.swapped[n.className || n.nodeName] = (window.swapped[n.className || n.nodeName] ?? 0) + 1);
  }).observe(document.querySelector('.part[data-part="item"]'), { childList: true });
  const history = [...document.querySelectorAll('details.fold')].at(-1);
  if (history) history.open = true;
  scrollTo(0, Math.min(600, document.documentElement.scrollHeight - innerHeight));
  return { y: scrollY, history: Boolean(history?.open) };
})()`);

// The first half, all three write elsewhere; the second, the third writes to the item on the page every third second.
const half = Date.now() + (Number(seconds) * 1000) / 2;
const end = Date.now() + Number(seconds) * 1000;
let n = 0;
let writes = 0;
const samples: { at: number; y: number; reloaded: boolean; redraws: number; onPage: boolean }[] = [];
const errors: string[] = [];
let onPage = '';
const look = () => chrome.evaluate<{ y: number; reloaded: boolean; redraws: number }>(`({ y: scrollY, reloaded: window.stillMark !== 1, redraws: window.redraws })`);
while (Date.now() < end) {
  n += 1;
  const there = Date.now() >= half && n % 3 === 0;
  const sent = [change('agent:writer-a', 'elsewhere', [{ op: 'update', id: made.a, title: `Still page: away a ${n}` }]), change('agent:writer-b', 'elsewhere', [{ op: 'update', id: made.b, title: `Still page: away b ${n}` }])];
  sent.push(there ? change('agent:writer-c', 'on the page', [{ op: 'update', id: made.on, title: (onPage = `Still page: on it ${n}`) }]) : change('agent:writer-c', 'elsewhere', [{ op: 'update', id: made.away, title: `Still page: elsewhere ${n}` }]));
  await Promise.all(sent).then(() => (writes += sent.length), (err) => errors.push(String(err)));
  await wait(1000);
  samples.push({ at: n, onPage: there, ...(await look()) });
}
await wait(4000);
const after = await chrome.evaluate<{ y: number; reloaded: boolean; history: boolean; shown: boolean; redraws: number; swapped: Record<string, number> }>(`(() => ({
  y: scrollY,
  reloaded: window.stillMark !== 1,
  history: Boolean([...document.querySelectorAll('details.fold')].at(-1)?.open),
  shown: document.querySelector('main').textContent.includes(${JSON.stringify(onPage)}),
  redraws: window.redraws,
  swapped: window.swapped,
}))()`);
chrome.close();
await change('agent:stable-setup', 'done, what it made archived', Object.values(made).map((id) => ({ op: 'archive', id })));

const firstOnPage = samples.findIndex((s) => s.onPage);
const result = {
  page,
  seconds: Number(seconds),
  writes,
  reloaded: after.reloaded || samples.some((s) => s.reloaded),
  moved: [...new Set([...samples.map((s) => s.y), after.y])].filter((y) => Math.abs(y - reader.y) > 1),
  scrolledTo: reader.y,
  historyStillOpen: reader.history && after.history,
  // While every write was elsewhere: how many parts of the page were put in place of what was there. None is the point.
  swapsWhileAllElsewhere: (firstOnPage < 0 ? samples.at(-1)!.redraws : samples[firstOnPage - 1]?.redraws) ?? 0,
  changeOnPageShown: after.shown,
  lastTitle: onPage,
  // The parts of the page put in place of what was there, by what each is: only for the changes on it.
  swaps: after.redraws,
  swapped: after.swapped,
  errors,
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.reloaded || result.moved.length || result.swapsWhileAllElsewhere || !result.changeOnPageShown ? 1 : 0);
