// A finished picture read off the marks a drawing answered (task e_tgmq6ffu): each step's box and its name as drawn, and
// each wire as the line the eye follows, with the boxes its ends land on. Read from the scene, not from a layout's own
// model, so every layout that answers marks is read alike. Pure: a scene in, a picture out.

export type Box = { id: string; l: number; r: number; t: number; u: number };
export type Name = { id: string; text: string; cut: boolean; px: number };
export type Wire = { order: boolean; part: boolean; points: number[][]; a: string | null; b: string | null };
export type Picture = { width: number; height: number; boxes: Box[]; names: Name[]; wires: Wire[] };

type Mark = [string, Record<string, any>, ...unknown[]];
const isMark = (v: unknown): v is Mark => Array.isArray(v) && typeof v[0] === 'string';
const classes = (m: Mark) => String(m[1]?.class ?? '').split(/\s+/);

/** Every mark under `v`, depth first, itself included. */
function* marks(v: unknown): Generator<Mark> {
  if (isMark(v)) {
    yield v;
    for (const kid of v.slice(2)) yield* marks(kid);
  } else if (Array.isArray(v)) for (const kid of v) yield* marks(kid);
}

/** The words of a mark, its title left out. */
const words = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : isMark(v) ? (v[0] === 'title' ? '' : v.slice(2).map(words).join('')) : Array.isArray(v) ? v.map(words).join('') : '');

/** An SVG path's points, its curves and arcs by their ends: enough for a box's bounds and a wire's line. */
export function pathPoints(d: string): { points: number[][]; moves: number[] } {
  const tokens = d.match(/[MLHVCAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const points: number[][] = [], moves: number[] = [];
  let at = [0, 0], start = [0, 0], op = '', k = 0;
  const num = () => Number(tokens[k++]);
  while (k < tokens.length) {
    if (/^[A-Z]$/i.test(tokens[k])) op = tokens[k++].toUpperCase();
    if (op === 'Z') { points.push([...start]); at = [...start]; continue; }
    if (op === 'M') { at = [num(), num()]; start = [...at]; moves.push(points.length); op = 'L'; }
    else if (op === 'L') at = [num(), num()];
    else if (op === 'H') at = [num(), at[1]];
    else if (op === 'V') at = [at[0], num()];
    else if (op === 'C') { k += 4; at = [num(), num()]; }
    else if (op === 'A') { k += 5; at = [num(), num()]; }
    else throw new Error(`A path command this reader does not know: ${op}`);
    points.push([...at]);
  }
  return { points, moves };
}

/** A line with repeated points and points along a straight run taken out. */
export function tidy(points: number[][]) {
  const out: number[][] = [];
  for (const p of points) {
    if (out.length && out.at(-1)![0] === p[0] && out.at(-1)![1] === p[1]) continue;
    if (out.length > 1) {
      const [a, b] = [out.at(-2)!, out.at(-1)!];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop();
    }
    out.push([...p]);
  }
  return out;
}

const boundsOf = (shape: Mark, id: string): Box => {
  const a = shape[1];
  if (shape[0] === 'rect') return { id, l: +a.x, r: +a.x + +a.width, t: +a.y, u: +a.y + +a.height };
  const { points } = pathPoints(String(a.d));
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { id, l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), u: Math.max(...ys) };
};

/** How far `p` is from box `b`: 0 on it or in it. */
export const away = (b: Box, p: number[]) => Math.hypot(Math.max(b.l - p[0], 0, p[0] - b.r), Math.max(b.t - p[1], 0, p[1] - b.u));

/** The box an end lands on: the nearest within `near`, else none (an end on another wire's trunk). */
export const landsOn = (boxes: Box[], p: number[], near = 3) => {
  let best: Box | null = null, d = near;
  for (const b of boxes) { const e = away(b, p); if (e <= d) [best, d] = [b, e]; }
  return best?.id ?? null;
};

/**
 * The picture a scene draws. `px` is how large a step's name is drawn and a stub's (the style's flow_text and
 * flow_stub_text). A step is a mark keyed `s:<id>`, its outline the mark classed lf-shape, its name its text; an order
 * wire is keyed `w:<n>`, any other tie `n:<n>` (part_of classed near). A wire broken where it passes under another is
 * read whole.
 */
export function readScene(scene: any, px: { text: number; stub: number }): Picture {
  const svg = scene?.svg, size = scene?.size ?? {};
  const boxes: Box[] = [], names: Name[] = [], wires: Wire[] = [];
  for (const mk of marks(svg)) {
    const key = String(mk[1]?.key ?? '');
    if (/^s:/.test(key)) {
      const id = key.slice(2), all = [...marks(mk.slice(2))];
      const shape = all.find((k) => classes(k).includes('lf-shape'));
      if (!shape) continue;
      boxes.push(boundsOf(shape, id));
      const text = all.find((k) => k[0] === 'text' && !classes(k).includes('lf-flag'));
      if (!text) continue;
      const lines = text.slice(2).some((k) => isMark(k) && k[0] === 'tspan') ? text.slice(2).filter(isMark).map(words) : [words(text)];
      names.push({ id, text: lines.join(' '), cut: lines.some((l) => l.endsWith('…')), px: classes(mk).includes('stub') ? px.stub : px.text });
    } else if (mk[0] === 'path' && /^[wn]:\d+$/.test(key)) {
      const points = tidy(pathPoints(String(mk[1].d)).points);
      if (points.length > 1) wires.push({ order: key.startsWith('w:'), part: classes(mk).includes('near'), points, a: null, b: null });
    }
  }
  for (const w of wires) [w.a, w.b] = [landsOn(boxes, w.points[0]), landsOn(boxes, w.points.at(-1)!)];
  return { width: +(size.width ?? size.w ?? 0), height: +(size.height ?? size.h ?? 0), boxes, names, wires };
}
