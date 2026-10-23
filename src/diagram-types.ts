// Type inheritance as diagrams, from the pack files: every type and what it extends, down to the seven kinds, with
// the capabilities each declares and the fields other packs add to it; the relation types and what they extend,
// with what each may join; and the packs, with what each requires. Handed the pack files as parsed JSON.

import { html, legend, style, type Edge, type Page, type Vertex } from './diagram-xml.ts';

/** What a pack file says, as far as the diagrams read it. */
export interface PackFile {
  id: string;
  title?: string;
  requires?: string[];
  types?: Array<{ id: string; title?: string; extends?: string; kind?: boolean; capabilities?: Record<string, unknown>; statuses?: { open?: string[]; closed?: string[] } }>;
  relations?: Array<{ id: string; title?: string; extends?: string; root?: boolean; from?: string[]; to?: string[] }>;
  extend?: Record<string, { fields?: Record<string, unknown> }>;
  actions?: unknown[];
  views?: unknown[];
  screens?: unknown[];
}

/** A colour for each pack, the same on every page: the kernel's packs in grey, the rest in turn. */
const KERNEL = ['core', 'sys'];
const PALETTE = ['#dae8fc', '#d5e8d4', '#ffe6cc', '#e1d5e7', '#fff2cc', '#f8cecc', '#d0f0f0', '#f5e0f0'];
const STROKES = ['#6c8ebf', '#82b366', '#d79b00', '#9673a6', '#d6b656', '#b85450', '#3a9a9a', '#b5739d'];
function colours(packs: PackFile[]) {
  const others = packs.map((p) => p.id).filter((p) => !KERNEL.includes(p)).sort();
  return (pack: string) => {
    if (KERNEL.includes(pack)) return { fill: pack === 'core' ? '#f5f5f5' : '#e6e6e6', stroke: '#666666' };
    const i = others.indexOf(pack) % PALETTE.length;
    return { fill: PALETTE[i], stroke: STROKES[i] };
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const BOX_W = 190, BOX_H = 44, COL = 250, ROW = 56;
const INHERITS = style({ edgeStyle: 'elbowEdgeStyle', elbow: 'horizontal', rounded: 0, html: 1, endArrow: 'block', endFill: 0, endSize: 10, strokeColor: '#666666' });

interface Node { id: string; pack: string; parent?: string; label: string; tooltip: string; root?: boolean }

/**
 * A forest drawn from the left: each root in the first column, what extends it in the next, and so on; each
 * subtree takes the rows of its leaves, so nothing crosses. Roots are drawn in the order given.
 */
function forest(nodes: Node[], roots: string[], colour: (pack: string) => { fill: string; stroke: string }, prefix: string) {
  const children = new Map<string, Node[]>();
  for (const n of nodes) if (n.parent) (children.get(n.parent) ?? children.set(n.parent, []).get(n.parent)!).push(n);
  for (const list of children.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  const vertices: Vertex[] = [], edges: Edge[] = [];
  const by = new Map(nodes.map((n) => [n.id, n]));
  let row = 0;
  const place = (n: Node, depth: number): number => {
    const kids = children.get(n.id) ?? [];
    const ys = kids.map((k) => place(k, depth + 1));
    const y = kids.length ? (ys[0] + ys[ys.length - 1]) / 2 : row++ * ROW;
    const c = colour(n.pack);
    vertices.push({ id: `${prefix}-${slug(n.id)}`, label: n.label, tooltip: n.tooltip, x: depth * COL, y, w: BOX_W, h: BOX_H, style: style({ rounded: 1, html: 1, whiteSpace: 'wrap', fontSize: n.root ? 13 : 11, fillColor: n.root ? '#4d4d4d' : c.fill, fontColor: n.root ? '#ffffff' : '#000000', strokeColor: c.stroke, strokeWidth: n.root ? 2 : 1 }) });
    for (const k of kids) edges.push({ id: `${prefix}-x-${slug(k.id)}`, from: `${prefix}-${slug(k.id)}`, to: `${prefix}-${slug(n.id)}`, style: INHERITS });
    return y;
  };
  for (const r of roots) {
    if (!by.has(r)) continue;
    place(by.get(r)!, 0);
    row += 0.5;
  }
  return { vertices, edges, height: row * ROW };
}

function typeNodes(packs: PackFile[]): { nodes: Node[]; kinds: string[] } {
  const added = new Map<string, string[]>();
  for (const p of packs) for (const [t, e] of Object.entries(p.extend ?? {})) {
    (added.get(t) ?? added.set(t, []).get(t)!).push(`${p.id} (${Object.keys(e.fields ?? {}).join(', ')})`);
  }
  const nodes: Node[] = [], kinds: string[] = [];
  for (const p of packs) for (const t of p.types ?? []) {
    const caps = Object.keys(t.capabilities ?? {});
    const statuses = [...(t.statuses?.open ?? []), '|', ...(t.statuses?.closed ?? [])].join(' ');
    const lines = [`<b>${html(t.title ?? t.id)}</b> <font color="${t.kind ? '#cccccc' : '#777777'}">${html(t.id)}</font>`];
    if (caps.length) lines.push(`<i>${html(caps.join(' · '))}</i>`);
    if (added.has(t.id)) lines.push(`<font color="#777777">+ fields from ${html(added.get(t.id)!.map((a) => a.split(' ')[0]).join(', '))}</font>`);
    const tooltip = [`${t.id}, from the ${p.id} pack.`, t.statuses ? `Statuses: ${statuses}.` : '', caps.length ? `Capabilities: ${caps.join(', ')}.` : '', added.has(t.id) ? `Fields added by ${added.get(t.id)!.join('; ')}.` : ''].filter(Boolean).join(' ');
    nodes.push({ id: t.id, pack: p.id, parent: t.extends, label: lines.join('<br>'), tooltip, root: t.kind });
    if (t.kind) kinds.push(t.id);
  }
  const known = new Set(nodes.map((n) => n.id));
  for (const n of nodes) if (n.parent && !known.has(n.parent)) throw new Error(`${n.id} extends ${n.parent}, which no pack defines`);
  return { nodes, kinds };
}

function packLegend(packs: PackFile[], colour: (pack: string) => { fill: string; stroke: string }, x: number, extra: Array<[string, string]>): Vertex[] {
  return legend('legend', x, 0, [...packs.map((p) => [colour(p.id).stroke, `${p.title ?? p.id} pack`] as [string, string]), ...extra]);
}

function inheritance(packs: PackFile[]): Page {
  const colour = colours(packs);
  const { nodes, kinds } = typeNodes(packs);
  const tree = forest(nodes, kinds, colour, 't');
  const width = Math.max(...tree.vertices.map((v) => v.x + v.w), 4 * COL);
  const vertices = [...tree.vertices, ...packLegend(packs, colour, width + 60, [['#666666', 'open arrow: extends (dark box: one of the kinds)'], ['#777777', 'italic: the capabilities a type declares']])];
  return { id: 'types-inheritance', name: 'Types: inheritance', vertices, edges: tree.edges };
}

function relationTree(packs: PackFile[]): Page {
  const colour = colours(packs);
  const nodes: Node[] = [], roots: string[] = [];
  for (const p of packs) for (const r of p.relations ?? []) {
    const ends = `${(r.from ?? ['*']).join(', ')} → ${(r.to ?? ['*']).join(', ')}`;
    nodes.push({ id: r.id, pack: p.id, parent: r.extends, root: r.root, label: `<b>${html(r.title ?? r.id)}</b> <font color="${r.root ? '#cccccc' : '#777777'}">${html(r.id)}</font><br><font style="font-size:10px">${html(ends)}</font>`, tooltip: `${r.id}, from the ${p.id} pack: ${ends}.` });
    if (r.root || !r.extends) roots.push(r.id);
  }
  // Roots with the most under them first, so the tall subtrees lead.
  const under = (id: string): number => nodes.filter((n) => n.parent === id).reduce((s, n) => s + 1 + under(n.id), 0);
  roots.sort((a, b) => under(b) - under(a) || a.localeCompare(b));
  const tree = forest(nodes, roots, colour, 'r');
  const width = Math.max(...tree.vertices.map((v) => v.x + v.w));
  return { id: 'types-relations', name: 'Types: relations', vertices: [...tree.vertices, ...packLegend(packs, colour, width + 60, [['#666666', 'open arrow: extends (dark box: a root relation)'], ['#777777', 'second line: what it may join, from → to']])], edges: tree.edges };
}

function packMap(packs: PackFile[]): Page {
  const colour = colours(packs);
  const vertices: Vertex[] = [], edges: Edge[] = [];
  const kernel = packs.filter((p) => KERNEL.includes(p.id)), others = packs.filter((p) => !KERNEL.includes(p.id));
  const count = (n: number | undefined, word: string) => (n ? `${n} ${word}${n === 1 ? '' : 's'}` : '');
  const box = (p: PackFile, x: number, y: number) => {
    const c = colour(p.id);
    const says = [count(p.types?.length, 'type'), count(p.relations?.length, 'relation'), count(p.actions?.length, 'action'), count(p.views?.length, 'view'), count(p.screens?.length, 'screen')].filter(Boolean).join(' · ');
    vertices.push({ id: `p-${slug(p.id)}`, label: `<b>${html(p.title ?? p.id)}</b><br><font style="font-size:10px">${html(says)}</font>`, x, y, w: 200, h: 50, style: style({ rounded: 1, html: 1, whiteSpace: 'wrap', fontSize: 12, fillColor: c.fill, strokeColor: c.stroke }) });
  };
  others.forEach((p, i) => box(p, i * 230, 0));
  const kw = others.length * 230 - 30;
  kernel.forEach((p, i) => box(p, (kw - kernel.length * 230 + 30) / 2 + i * 230, 160));
  for (const p of packs) for (const r of p.requires ?? []) {
    if (packs.some((q) => q.id === r)) edges.push({ id: `req-${slug(p.id)}-${slug(r)}`, from: `p-${slug(p.id)}`, to: `p-${slug(r)}`, style: style({ endArrow: 'open', html: 1, strokeColor: '#999999', curved: 0 }) });
  }
  vertices.push(...legend('legend', Math.max(kw, 460) + 60, 0, [['#999999', 'arrow: requires'], ['#666666', 'grey: the kernel’s own packs']]));
  return { id: 'types-packs', name: 'Types: packs', vertices, edges };
}

/** The pages of the type diagram: inheritance, relations, packs. */
export function typeDiagram(packs: PackFile[]): Page[] {
  const sorted = [...packs].sort((a, b) => (KERNEL.indexOf(a.id) + 1 || 9) - (KERNEL.indexOf(b.id) + 1 || 9) || a.id.localeCompare(b.id));
  return [inheritance(sorted), relationTree(sorted), packMap(sorted)];
}
