// The cola layout (core.cola) drawn offline on a flow replay (scripts/flow-replay.ts keeps them, under
// runs/flow-replay/<name>.json) as the page draws it: the drawing's own entry (flow's index.js, with rows' modules
// under their names) run in Node on the replay's input and measured widths, WebCola given as the page's tools give it,
// the house style's cola_* sizes added where
// the replay's style predates them. The scene is written as a page and a PNG, with how long it took, its crossings
// and every stage the layout told.
//   node scripts/cola-replay.ts <name> [replay folder] [out folder] [layout id]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open } from '../test/browser.ts';
import { drawings, setOut } from '../test/wired.ts';

const [name, from = join(import.meta.dirname, '..', 'runs', 'flow-replay'), to = join(import.meta.dirname, '..', 'runs', 'cola'), id = 'core.cola'] = process.argv.slice(2);
if (!name) throw new Error('cola-replay <name> [replay folder] [out folder] [layout id]');
const kept = JSON.parse(readFileSync(join(from, `${name}.json`), 'utf8'));
const house = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packs', 'core', 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
const input = { ...kept.input, style: { ...kept.input.style, sizes: { ...house.sizes, ...kept.input.style.sizes } } };
let guessed = 0;
const measure = (words: string, px: number, font: string, as: any) => {
  const said = as?.case === 'upper' ? String(words).toUpperCase() : String(words);
  const key = `${as?.style === 'italic' ? 'italic ' : ''}${as?.weight === 600 ? 600 : 400} ${px}px ${font || 'system-ui'}|${said}`;
  const track = /^-?\d+(\.\d+)?em$/.test(as?.track ?? '') ? parseFloat(as.track) * px * [...said].length : 0;
  if (kept.widths[key] === undefined) guessed++;
  return (kept.widths[key] ?? [...said].length * px * 0.55) + track;
};
const drawing = drawings.find((d) => d.id === id)!;
const { scene, ms, told, lines } = await setOut(drawing, async (url) => {
  const told: { name: string; snapshot: any }[] = [];
  const { stages } = await import(url('stage.js'));
  stages((n: string, snapshot: any) => told.push({ name: n, snapshot }));
  const { picture } = await import(url('index.js'));
  const t0 = performance.now();
  const drawn = await picture(input, { measure, patch() {}, open() {}, frame: () => new Promise(() => {}), surface: () => null, cola: async () => (await import('../ui/cola.module.min.js')).default });
  const ms = performance.now() - t0, last = told.filter((t) => t.name === 'finish').at(-1)?.snapshot;
  return { scene: drawn?.scene, ms, told, lines: last ? [...last.chains, ...last.ties] : [] };
});

/** Crossings between two different stretches, each stretch counted once. */
function crossings(lines: number[][][]) {
  const unique = new Map<string, number[][]>();
  for (const l of lines) l.slice(1).forEach((p, k) => unique.set([l[k], p].map((v) => v.join(',')).sort().join(' '), [l[k], p]));
  const s = [...unique.values()];
  let n = 0;
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
    const [[a, b], [c, d]] = [s[i], s[j]], [h1, h2] = [a[1] === b[1], c[1] === d[1]];
    if (h1 === h2) continue;
    const [hz, vt] = h1 ? [[a, b], [c, d]] : [[c, d], [a, b]], [x, y] = [vt[0][0], hz[0][1]];
    if (x > Math.min(hz[0][0], hz[1][0]) && x < Math.max(hz[0][0], hz[1][0]) && y > Math.min(vt[0][1], vt[1][1]) && y < Math.max(vt[0][1], vt[1][1])) n++;
  }
  return n;
}

// The page's theme, as far as the scene reads it: dark, as the owner's screen is.
const theme = `:root { --ln-land: #232323; --ln-line: #9aa0a6; --ln-text: #e8e8e8; --ln-muted: #8a8f98; --ln-you: #e0a458; --ln-font: system-ui; --accent: #6cc; }
body { margin: 0; background: #171717; color: #e8e8e8; font-family: system-ui; }`;
const vars = Object.entries(input.style.sizes).filter(([k]) => k.startsWith('flow_')).map(([k, v]) => `--ln-${k.replace(/_/g, '-')}: ${typeof v === 'number' ? `${v}px` : v};`).join(' ');
/** Marks as markup, as ui/marks.js builds them but without what only a page does (keys, events, items, pulses). */
const esc = (t: unknown) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const markup = (m: any): string => {
  if (typeof m === 'string' || typeof m === 'number') return esc(m);
  if (!Array.isArray(m)) return '';
  const [tag, attrs = {}, ...kids] = m, shown = Object.entries(attrs ?? {}).filter(([k]) => !['key', 'on', 'item', 'pulse'].includes(k));
  return `<${tag}${tag === 'svg' ? ' xmlns="http://www.w3.org/2000/svg"' : ''}${shown.map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}>${kids.map(markup).join('')}</${tag}>`;
};
const page = `<!doctype html><meta charset="utf-8"><style>${theme} :root { ${vars} } ${scene?.css ?? ''}</style>${typeof scene?.svg === 'string' ? scene.svg : markup(scene?.svg)}`;
mkdirSync(to, { recursive: true });
writeFileSync(join(to, `${name}.html`), page);
writeFileSync(join(to, `${name}.stages.json`), JSON.stringify({ ms, stages: told }));
const size = scene?.size ?? {}, [w, h] = Array.isArray(size) ? size : [size.w ?? size.width ?? 1600, size.h ?? size.height ?? 1000];
const tab = await open('about:blank');
await tab.send('Emulation.setDeviceMetricsOverride', { width: Math.min(Math.ceil(w), 4000), height: Math.min(Math.ceil(h), 4000), deviceScaleFactor: 1, mobile: false });
await tab.evaluate(`document.open(); document.write(${JSON.stringify(page)}); document.close(); true`);
await new Promise((r) => setTimeout(r, 300));
writeFileSync(join(to, `${name}.png`), await tab.screenshot());
await tab.close();
console.log(`${name} (${id}): ${Math.round(w)} by ${Math.round(h)}, ${lines.length} wires, ${crossings(lines)} crossings, drawn in ${ms.toFixed(1)} ms${guessed ? `, ${guessed} widths guessed` : ''} -> ${join(to, name)}.png`);
process.exit();
