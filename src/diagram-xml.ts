// Diagrams as draw.io (diagrams.net) files: the mxGraph XML the tool opens, and the layouts the diagrams share.
// Nothing here reads a file or the map: cells go in, XML comes out, the same every time for the same cells, so a
// regenerated diagram differs from the last only where the code did.

export interface Vertex {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style: string;
  /** A container this sits in; its x and y are then inside it. */
  parent?: string;
  tooltip?: string;
  link?: string;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  style: string;
  label?: string;
}

export interface Page {
  id: string;
  name: string;
  vertices: Vertex[];
  edges: Edge[];
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\n': '&#10;' };
export const esc = (s: string) => s.replace(/[&<>"'\n]/g, (c) => ESCAPES[c]);
/** Text for a label drawn as HTML (html=1): escaped once for HTML here, and again for XML when written. */
export const html = (s: string) => s.replace(/[&<>]/g, (c) => ESCAPES[c]);

/** A style string from its parts, in the order given. */
export const style = (parts: Record<string, string | number>) =>
  Object.entries(parts).map(([k, v]) => `${k}=${v}`).join(';') + ';';

function vertexXml(v: Vertex): string {
  const geometry = `<mxGeometry x="${Math.round(v.x)}" y="${Math.round(v.y)}" width="${Math.round(v.w)}" height="${Math.round(v.h)}" as="geometry"/>`;
  const parent = v.parent ?? '1';
  if (!v.tooltip && !v.link) {
    return `<mxCell id="${esc(v.id)}" value="${esc(v.label)}" style="${esc(v.style)}" vertex="1" parent="${esc(parent)}">${geometry}</mxCell>`;
  }
  const attrs = [`label="${esc(v.label)}"`, v.tooltip ? `tooltip="${esc(v.tooltip)}"` : '', v.link ? `link="${esc(v.link)}"` : '', `id="${esc(v.id)}"`];
  return `<UserObject ${attrs.filter(Boolean).join(' ')}><mxCell style="${esc(v.style)}" vertex="1" parent="${esc(parent)}">${geometry}</mxCell></UserObject>`;
}

const edgeXml = (e: Edge) =>
  `<mxCell id="${esc(e.id)}" value="${esc(e.label ?? '')}" style="${esc(e.style)}" edge="1" parent="1" source="${esc(e.from)}" target="${esc(e.to)}"><mxGeometry relative="1" as="geometry"/></mxCell>`;

export function pageXml(page: Page): string {
  const known = new Set(page.vertices.map((v) => v.id));
  const missing = page.edges.filter((e) => !known.has(e.from) || !known.has(e.to));
  if (missing.length) throw new Error(`${page.name}: edges to no vertex: ${missing.map((e) => e.id).join(', ')}`);
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>', ...page.vertices.map(vertexXml), ...page.edges.map(edgeXml)];
  return [
    `  <diagram id="${esc(page.id)}" name="${esc(page.name)}">`,
    `    <mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0">`,
    `      <root>`,
    ...cells.map((c) => `        ${c}`),
    `      </root>`,
    `    </mxGraphModel>`,
    `  </diagram>`,
  ].join('\n');
}

/** One draw.io file holding the pages, each a tab when it is opened. */
export const mxfile = (pages: Page[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="archipelago" type="device">\n${pages.map(pageXml).join('\n')}\n</mxfile>\n`;

/**
 * Layers for a directed graph drawn from the top down: every edge points to a lower layer where it can (a node is
 * one below the lowest node that points at it), edges that close a cycle are left out of the reckoning, and nodes
 * in a layer are ordered to sit near what they connect to (a few sweeps of the barycentre heuristic).
 */
export function layers(nodes: string[], edges: Array<[string, string]>): string[][] {
  const out = new Map(nodes.map((n) => [n, [] as string[]]));
  for (const [a, b] of edges) if (a !== b && out.has(a) && out.has(b) && !out.get(a)!.includes(b)) out.get(a)!.push(b);
  // Leave out the edges that close a cycle: a depth-first walk drops each edge back to a node still on its path.
  const state = new Map<string, 'on' | 'done'>();
  const forward = new Map(nodes.map((n) => [n, [] as string[]]));
  const walk = (v: string) => {
    state.set(v, 'on');
    for (const w of out.get(v)!) {
      if (state.get(w) === 'on') continue;
      forward.get(v)!.push(w);
      if (!state.has(w)) walk(w);
    }
    state.set(v, 'done');
  };
  for (const n of nodes) if (!state.has(n)) walk(n);
  const depth = new Map<string, number>();
  const visit = (v: string): number => {
    if (depth.has(v)) return depth.get(v)!;
    depth.set(v, 0);
    let d = 0;
    for (const [a, bs] of forward) if (bs.includes(v)) d = Math.max(d, visit(a) + 1);
    depth.set(v, d);
    return d;
  };
  nodes.forEach(visit);
  const rows: string[][] = [];
  for (const n of nodes) (rows[depth.get(n)!] ??= []).push(n);
  const filled = rows.filter(Boolean);
  const neighbours = (v: string) => [...out.get(v)!, ...nodes.filter((u) => out.get(u)!.includes(v))];
  for (let sweep = 0; sweep < 4; sweep++) {
    const order = (row: string[], ref: string[]) => {
      const at = new Map(ref.map((n, i) => [n, i]));
      const centre = (v: string) => {
        const near = neighbours(v).filter((u) => at.has(u)).map((u) => at.get(u)!);
        return near.length ? near.reduce((s, i) => s + i, 0) / near.length : row.indexOf(v);
      };
      const keyed = row.map((v) => [v, centre(v)] as const);
      return keyed.sort((p, q) => p[1] - q[1] || p[0].localeCompare(q[0])).map(([v]) => v);
    };
    const down = sweep % 2 === 0;
    for (let i = down ? 1 : filled.length - 2; down ? i < filled.length : i >= 0; i += down ? 1 : -1) {
      filled[i] = order(filled[i], filled[down ? i - 1 : i + 1]);
    }
  }
  return filled;
}

/** Rows of at most `per` items each, for laying chips out in a container. */
export const wrap = <T>(items: T[], per: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / per) }, (_, i) => items.slice(i * per, i * per + per));

/** A key to the colours and marks of a page, drawn as one box of lines at a place. */
export function legend(id: string, x: number, y: number, lines: Array<[string, string]>): Vertex[] {
  const rows = lines.map(([colour, text]) => `<font color="${colour}">■</font> ${html(text)}`).join('<br>');
  return [{
    id, label: `<b>Key</b><br>${rows}`, x, y, w: 300, h: 24 + lines.length * 15,
    style: style({ rounded: 1, html: 1, whiteSpace: 'wrap', align: 'left', verticalAlign: 'top', spacingLeft: 8, spacingTop: 4, fillColor: '#ffffff', strokeColor: '#bbbbbb', fontSize: 11 }),
  }];
}
