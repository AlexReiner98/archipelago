// The measures written out (task e_tgmq6ffu): one table per view with the layouts as columns, as Markdown for the chat
// and as a page with each picture under its numbers. Pure: results in, text out.

import type { Measures } from './measures.ts';

export type Drawn = { m: Measures; moved: { mean: number; share: number }; ms: number; png?: string } | { error: string };
export type View = { name: string; lens: string; layouts: Record<string, Drawn> };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const f = (x: number, d = 1) => x.toFixed(d);

/** Each row: what it reads, which way is better, and its cell. Crossings last, as a footnote only. */
export const ROWS: { name: string; better: string; cell: (d: Extract<Drawn, { m: any }>) => string }[] = [
  { name: 'Order wires running up', better: 'fewer, one side', cell: ({ m: { upward: u } }) => `${u.up} of ${u.order}${u.up ? (u.oneSide ? `, all ${u.left ? 'left' : 'right'}` : `, ${u.left} left ${u.right} right`) : ''}` },
  { name: 'Bends per wire', better: 'fewer', cell: ({ m: { bends: b } }) => `${f(b.mean, 2)} (most ${b.most})${b.slanted ? `, ${b.slanted} slanted` : ''}` },
  { name: 'Detour', better: 'nearer 1', cell: ({ m: { detour: d } }) => `${f(d.mean, 2)} (most ${f(d.most)})` },
  { name: 'Most wires side by side', better: 'fewer', cell: ({ m }) => `${m.ribbon.most}` },
  { name: 'Wires through a step', better: 'none', cell: ({ m }) => `${m.through}` },
  { name: 'Names readable at 1600×1000', better: 'more', cell: ({ m: { names: n } }) => `${pct(n.share)} (at ${f(n.px)} px${n.cut ? `, ${n.cut} cut` : ''})` },
  { name: 'Moved when one item is added', better: 'less', cell: ({ moved }) => `${pct(moved.share)} (${Math.round(moved.mean)} px)` },
  { name: 'Time to draw', better: 'less', cell: ({ ms }) => `${Math.round(ms)} ms` },
  { name: 'Size, items, wires', better: '', cell: ({ m }) => `${m.size[0]}×${m.size[1]}, ${m.items}, ${m.wires}` },
  { name: 'Crossings seen (footnote)', better: '', cell: ({ m }) => `${m.seen}` },
];

const cellOf = (d: Drawn | undefined, row: (typeof ROWS)[number]) => (!d ? '' : 'error' in d ? 'failed' : row.cell(d));
const short = (id: string) => id.replace(/^core\./, '');

/** One view's table, in Markdown. */
export function table(view: View) {
  const ids = Object.keys(view.layouts);
  return [`### ${view.name} (${view.lens})`, '', `| | ${ids.map(short).join(' | ')} | better |`, `|---|${ids.map(() => '---|').join('')}---|`,
    ...ROWS.map((r) => `| ${r.name} | ${ids.map((id) => cellOf(view.layouts[id], r)).join(' | ')} | ${r.better} |`),
    ...ids.flatMap((id) => ((d) => ('error' in d ? [`\n${short(id)} failed: ${d.error}`] : []))(view.layouts[id])),
  ].join('\n');
}

const esc = (t: unknown) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The page: per view, its table, then each layout's picture in a column under its name. */
export function page(views: View[], when: string) {
  const section = (v: View) => {
    const ids = Object.keys(v.layouts);
    const head = `<tr><th></th>${ids.map((id) => `<th>${esc(short(id))}</th>`).join('')}<th class="b">better</th></tr>`;
    const rows = ROWS.map((r, k) => `<tr${k === ROWS.length - 1 ? ' class="foot"' : ''}><td>${esc(r.name)}</td>${ids.map((id) => `<td>${esc(cellOf(v.layouts[id], r))}</td>`).join('')}<td class="b">${esc(r.better)}</td></tr>`).join('');
    const pics = ids.map((id) => ((d) => `<figure><figcaption>${esc(short(id))}</figcaption>${'png' in d && d.png ? `<a href="${esc(d.png)}"><img src="${esc(d.png)}" loading="lazy"></a>` : `<p>${esc('error' in d ? d.error : 'no picture')}</p>`}</figure>`)(v.layouts[id])).join('');
    return `<section><h2>${esc(v.name)} <span>${esc(v.lens)}</span></h2><table>${head}${rows}</table><div class="pics" style="--n:${ids.length}">${pics}</div></section>`;
  };
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Layout measures</title>
<style>
:root { color-scheme: dark; --bg: #171717; --fg: #e8e8e8; --muted: #8a8f98; --line: #333; }
body { margin: 0 auto; padding: 24px 16px; max-width: 1800px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
h1 { font-size: 18px; margin: 0 0 4px; } h1 + p { color: var(--muted); margin: 0 0 24px; }
h2 { font-size: 16px; margin: 32px 0 8px; } h2 span { color: var(--muted); font-weight: 400; font-size: 13px; }
table { border-collapse: collapse; width: 100%; } td, th { padding: 4px 10px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
th { font-weight: 600; } .b { color: var(--muted); } tr.foot td { color: var(--muted); font-size: 12px; }
.pics { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
figure { margin: 0; } figcaption { color: var(--muted); margin-bottom: 4px; } img { width: 100%; height: auto; border: 1px solid var(--line); background: #1d1d1d; }
@media (max-width: 760px) { .pics { grid-template-columns: 1fr; } table { display: block; overflow-x: auto; } }
</style>
<h1>Layout measures</h1><p>Read off each finished picture of the replays, drawn through each layout's own entry. ${esc(when)}</p>
${views.map(section).join('\n')}`;
}
