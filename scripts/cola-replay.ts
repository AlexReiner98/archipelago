// The cola layout (packs/core/layouts/cola/) drawn offline on kept replays (scripts/flow-replay.ts): each laid out twice
// to check it rests the same, its steps kept, and drawn as a plain picture to judge by eye, until the kit draws it.
//   node scripts/cola-replay.ts [name ...]     (default: built principles ias study)
// Writes runs/cola/<name>.svg, .png (headless Chrome, where there is one) and .json (the steps' snapshots).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-ignore: a pack's drawing code, plain JavaScript
import { colaLayout } from '../packs/core/layouts/cola/index.js';
// @ts-ignore
import { modelOf } from '../packs/core/layouts/cola/adapter.js';
// @ts-ignore
import { stepsOf } from '../packs/core/layouts/flow/steps.js';
// @ts-ignore: WebCola, vendored
import cola from '../ui/cola.module.min.js';

const root = join(import.meta.dirname, '..'), out = join(root, 'runs', 'cola');
mkdirSync(out, { recursive: true });
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['built', 'principles', 'ias', 'study'];
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A replay's model, its texts measured by the widths the page measured. */
export function replayModel(name: string) {
  const kept = JSON.parse(readFileSync(join(root, 'runs', 'flow-replay', `${name}.json`), 'utf8'));
  const style = kept.input.style, font = style.font;
  const measure = (t: string, px: number) => kept.widths[`400 ${px}px ${font}|${t}`] ?? kept.widths[`400 ${px}px system-ui|${t}`] ?? 0.55 * px * String(t).length;
  const sizes = (items: any[], links: any[]) => stepsOf({ items, links, measure, sizes: style.sizes, shapes: { type: style.type_shapes ?? {} } }).nodes;
  return { kept, style, model: modelOf(kept.input.answer, (items: any[], links: any[]) => new Map([...sizes(items, links)].map(([id, n]: any) => [id, { w: n.w, h: n.h, lines: n.lines, shape: n.shape }]))) };
}

/** The picture as SVG: island frames, wires (order ones dark and headed), boxes with their names. */
function svgOf(model: any, got: any, style: any) {
  const hue = (id: string) => style.island_hues[(model.islands.findIndex((i: any) => i.id === id) + style.island_hues.length) % style.island_hues.length];
  const colour = (t: string) => style.link_colours?.[t] ?? '#8a8f99';
  const byId = new Map(model.items.map((i: any) => [i.id, i]));
  const isles = got.islands.map((f: any) => `<rect x="${f.l}" y="${f.t}" width="${f.r - f.l}" height="${f.b - f.t}" rx="12" fill="${hue(f.id)}" fill-opacity="0.08" stroke="${hue(f.id)}" stroke-width="1.25"/><text x="${f.l + 10}" y="${f.t + 14}" font-size="10" letter-spacing="1.4" fill="${hue(f.id)}" font-family="Georgia">${esc((model.islands.find((i: any) => i.id === f.id)?.title ?? '').toUpperCase())}</text>`);
  const wires = got.wires.map((w: any) => {
    const d = 'M' + w.points.map((p: number[]) => p.join(' ')).join('L');
    const [a, b] = w.points.slice(-2), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const head = (s: number) => `${b[0] - s * Math.cos(ang) + 0.5 * s * Math.sin(ang)} ${b[1] - s * Math.sin(ang) - 0.5 * s * Math.cos(ang)}`;
    const headed = w.type !== 'part_of';
    return `<path d="${d}" fill="none" stroke="${colour(w.type)}" stroke-width="${w.order ? 1.5 : 1}" stroke-opacity="${w.order ? 1 : 0.55}"${w.type === 'part_of' ? ' stroke-dasharray="3 3"' : ''}/>` + (headed ? `<path d="M${b.join(' ')}L${head(8)}L${(() => { const s = 8; return `${b[0] - s * Math.cos(ang) - 0.5 * s * Math.sin(ang)} ${b[1] - s * Math.sin(ang) + 0.5 * s * Math.cos(ang)}`; })()}Z" fill="${colour(w.type)}" fill-opacity="${w.order ? 1 : 0.7}"/>` : '');
  });
  const boxes = got.boxes.map((b: any) => {
    const it: any = byId.get(b.id), lines: string[] = it.lines ?? [it.title];
    const top = b.y - ((lines.length - 1) * 16) / 2 + 4.5;
    return `<g><rect x="${b.x - b.w / 2}" y="${b.y - b.h / 2}" width="${b.w}" height="${b.h}" rx="${it.shape === 'pill' ? b.h / 2 : 6}" fill="#fff" stroke="#59636e" stroke-width="1.25"/>` + lines.map((t, n) => `<text x="${b.x - b.w / 2 + 21}" y="${top + n * 16}" font-size="13" font-family="system-ui, Segoe UI, sans-serif" fill="#1f2328">${esc(t)}</text>`).join('') + `</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${got.width}" height="${got.height}" viewBox="0 0 ${got.width} ${got.height}"><rect width="100%" height="100%" fill="#fbfbf9"/>${isles.join('')}${wires.join('')}${boxes.join('')}</svg>`;
}

export function laidOut(name: string) {
  const { model, style } = replayModel(name);
  const stages: Record<string, unknown> = {};
  const t0 = performance.now();
  // The house style's cola lengths under what the page was drawn with: a replay kept before they were named lacks them.
  const house = JSON.parse(readFileSync(join(root, 'packs', 'core', 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house');
  const got = colaLayout(model, { ...(house.props ?? house).sizes, ...style.sizes }, cola, (n: string, s: unknown) => (stages[n] = s));
  return { model, style, got, stages, ms: Math.round(performance.now() - t0) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let page: any = null;
  try { page = await (await import('../test/browser.ts')).open('about:blank'); } catch { console.log('No Chrome: SVG only'); }
  for (const name of names) {
    const { model, style, got, stages, ms } = laidOut(name);
    const again = laidOut(name).got, same = JSON.stringify(again) === JSON.stringify(got);
    const svg = svgOf(model, got, style);
    writeFileSync(join(out, `${name}.svg`), svg);
    writeFileSync(join(out, `${name}.json`), JSON.stringify({ stages, dropped: got.dropped }, null, 1));
    if (page) {
      writeFileSync(join(out, `${name}.html`), `<!doctype html><body style="margin:0">${svg}</body>`);
      await page.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(got.width), height: Math.ceil(got.height), deviceScaleFactor: 1, mobile: false });
      await page.go(pathToFileURL(join(out, `${name}.html`)).href);
      writeFileSync(join(out, `${name}.png`), await page.screenshot());
    }
    console.log(`${name}: ${model.items.length} items, ${got.wires.length} wires, ${got.dropped.length} order links dropped, ${Math.round(got.width)}x${Math.round(got.height)}, ${ms} ms, ${same ? 'the same twice' : 'DIFFERENT the second time'}`);
  }
  page?.close();
  process.exit();
}
