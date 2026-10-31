// A ridges picture baked as SVG: the Ridges style's own code, run here on one saved setup, its paint calls kept as
// paths instead of pixels, so the picture is as sharp at any width as the drawing is on the canvas.
//   node scripts/ridges-svg.ts <style code .js> <setup .json> <out .svg> [tolerance px, 0.05]
// The style's code is its `code` field (query get of the Ridges style), the setup a local.ridges_setup's `setup`.
// Each path keeps the points that stand more than the tolerance off a straight line, written relative, a tenth of a
// unit apart: the Hero at 1600 × 800 is some 700 kB, 110 kB gzipped, under the 10 MB a figure may be.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [codeFile, setupFile, outFile, tolerance = '0.05'] = process.argv.slice(2);
if (!outFile) throw new Error('node scripts/ridges-svg.ts <style code .js> <setup .json> <out .svg> [tolerance]');

type Point = [number, number];
type Context = Record<string, any>;
type Bake = { apply: (setup: unknown) => void; picture: () => { pic: { width: number; height: number }; opts: unknown }; paint: (g: Context, pic: unknown, opts: unknown) => void };

/** The style's draw, with a hold on its picture: what it would paint for a setup, and its own paint. */
async function bakeOf(code: string): Promise<Bake> {
  const hook = 'function render() {';
  if (!code.includes(hook)) throw new Error('This is not the Ridges style: it has no render().');
  const hooked = code.replace(hook, `globalThis.__ridges = { apply: (s) => apply(s), picture: () => ({ pic: shown(view.pic), opts: view.opts }), paint };\n  ${hook}`);
  // Its page is never shown here: every canvas it asks for takes anything and keeps nothing.
  const nothing = (): any => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : nothing()), apply: () => nothing(), set: () => true });
  Object.assign(globalThis, { OffscreenCanvas: class { getContext = () => nothing(); } });
  const file = `${outFile}.style.mjs`;
  writeFileSync(file, hooked);
  try {
    const draw = (await import(pathToFileURL(file).href)).default;
    const quiet = () => {};
    draw({ canvas: { width: 0, height: 0, getContext: () => nothing() }, answer: { items: [] }, size: { width: 1200, height: 800, dpr: 1 }, on: quiet, tip: quiet, cursor: quiet, field: quiet, change: quiet, theme: {} });
  } finally {
    rmSync(file, { force: true });
  }
  return (globalThis as any).__ridges;
}

/** The points of a line that stand more than tol off the straight line between those kept (Douglas–Peucker). */
function fewer(p: Point[], tol: number): Point[] {
  if (p.length < 3) return p;
  const keep: Point[] = [p[0]];
  const walk = (a: number, b: number) => {
    const [x1, y1] = p[a], [x2, y2] = p[b], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    let far = -1, at = 0;
    for (let i = a + 1; i < b; i++) {
      const off = len ? Math.abs(dy * p[i][0] - dx * p[i][1] + x2 * y1 - y2 * x1) / len : Math.hypot(p[i][0] - x1, p[i][1] - y1);
      if (off > far) (far = off), (at = i);
    }
    if (far > tol) walk(a, at), keep.push(p[at]), walk(at, b);
  };
  walk(0, p.length - 1);
  keep.push(p[p.length - 1]);
  return keep;
}

/** A path's points as SVG, relative and to a tenth: h and v where a step is flat. */
function written(points: Point[], closed: boolean): string {
  const n = (tenths: number) => (tenths / 10).toString().replace(/^(-?)0\./, '$1.');
  let d = '', px = 0, py = 0;
  points.forEach(([x, y], i) => {
    const X = Math.round(x * 10), Y = Math.round(y * 10);
    if (!i) d += `M${n(X)} ${n(Y)}`;
    else if (X === px && Y === py) return;
    else if (Y === py) d += `h${n(X - px)}`;
    else if (X === px) d += `v${n(Y - py)}`;
    else d += `l${n(X - px)}${Y < py ? '' : ' '}${n(Y - py)}`;
    (px = X), (py = Y);
  });
  return d + (closed ? 'Z' : '');
}

/** A 2D context that keeps what is painted as SVG elements: a fill and the stroke after it on the same path are one. */
function recorder(tol: number) {
  const out: string[] = [];
  let points: Point[] = [], closed = false, filled = -1;
  const width = (w: number) => +w.toFixed(2);
  const g: Context = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, lineJoin: 'round', lineCap: 'round',
    fillRect(x: number, y: number, w: number, h: number) {
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${g.fillStyle}"/>`);
      filled = -1;
    },
    beginPath: () => ((points = []), (closed = false), (filled = -1)),
    moveTo: (x: number, y: number) => points.push([x, y]),
    lineTo: (x: number, y: number) => points.push([x, y]),
    closePath: () => (closed = true),
    fill() {
      out.push(`<path d="${written(fewer(points, tol), closed)}" fill="${g.fillStyle}"${g.globalAlpha < 1 ? ` fill-opacity="${g.globalAlpha}"` : ''}/>`);
      filled = out.length - 1;
    },
    stroke() {
      const stroke = ` stroke="${g.strokeStyle}" stroke-width="${width(g.lineWidth)}"`;
      if (filled >= 0) out[filled] = out[filled].replace(/\/>$/, `${stroke}/>`);
      else out.push(`<path d="${written(fewer(points, tol), closed)}" fill="none"${stroke}/>`);
    },
  };
  return { g, out };
}

const bake = await bakeOf(readFileSync(codeFile, 'utf8'));
bake.apply(JSON.parse(readFileSync(setupFile, 'utf8')));
const { pic, opts } = bake.picture();
const { g, out } = recorder(Number(tolerance));
bake.paint(g, pic, opts);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pic.width} ${pic.height}" width="${pic.width}" height="${pic.height}" stroke-linejoin="round" stroke-linecap="round">${out.join('')}</svg>\n`;
writeFileSync(outFile, svg);
console.log(`${outFile}: ${pic.width} × ${pic.height}, ${out.length} shapes, ${(svg.length / 1000).toFixed(0)} kB`);
