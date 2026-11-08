// A view drawn offline exactly as a page draws it: what the page hands the flow drawing (answer, style, size), every
// text width the drawing asks Chrome for, and the scene it answered, kept in one file; then the drawing run again in
// Node on that input with those widths, and its scene checked against the page's.
//   node scripts/flow-replay.ts capture <lens id> [name] [width height] [http://127.0.0.1:3100]
//   node scripts/flow-replay.ts replay <name>
// Kept under runs/flow-replay/<name>.json. Capture needs the server with PELAGO_UNSANDBOXED=1, so the drawing's frame is
// the page's own and its messages can be read. `replay` exits 1 when the scene differs from the page's: then this copy
// does not behave as the page does, and nothing found with it holds there.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { open } from '../test/browser.ts';

const [verb, ...rest] = process.argv.slice(2);
const home = join(import.meta.dirname, '..', 'runs', 'flow-replay');
const flow = join(import.meta.dirname, '..', 'packs', 'core', 'layouts', 'flow');
mkdirSync(home, { recursive: true });

/** The measure the drawing's worker uses (ui/draw-marks.js), keyed as it keys them: "<font>|<text>", plus a role's track. */
const keyOf = (words: string, px: number, font: string, as: any) => {
  const said = as?.case === 'upper' ? String(words).toUpperCase() : String(words);
  return { said, key: `${as?.style === 'italic' ? 'italic ' : ''}${as?.weight === 600 ? 600 : 400} ${px}px ${font || 'system-ui'}|${said}` };
};
const track = (said: string, px: number, as: any) => (/^-?\d+(\.\d+)?em$/.test(as?.track ?? '') ? parseFloat(as.track) * px * [...said].length : 0);

/** The scene as plain data, so two can be compared whole. */
const plainScene = (scene: unknown) => JSON.parse(JSON.stringify(scene ?? null));

async function capture(lens: string, name = lens, width = 1600, height = 1000, base = 'http://127.0.0.1:3100') {
  const page = await open('about:blank');
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  // The drawing is run again in the page from blobs, as its worker runs it, which the page's own policy would refuse.
  await page.send('Page.setBypassCSP', { enabled: true });
  // Before the page's own code: keep what it tells the drawing to start on, and the scene the drawing answers.
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const send = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (m, ...more) { if (m && m.type === 'start') window.__start = JSON.parse(JSON.stringify(m.input)); return send.call(this, m, ...more); };
      const set = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage').set;
      Object.defineProperty(MessagePort.prototype, 'onmessage', { set(f) { set.call(this, (ev) => { if (ev.data && ev.data.type === 'scene') window.__scene = JSON.parse(JSON.stringify(ev.data.scene)); return f && f(ev); }); } });
    })()`,
  });
  await page.go(`${base}/#/v?canvas=${lens}`);
  for (let n = 0; n < 600 && !(await page.evaluate('Boolean(window.__start && window.__scene)')); n++) await new Promise((r) => setTimeout(r, 100));
  if (!(await page.evaluate('Boolean(window.__start && window.__scene)'))) throw new Error(`The page drew nothing (is the server on ${base} running with PELAGO_UNSANDBOXED=1?): ${page.logs().slice(-5).join(' | ')}`);
  // Every width the drawing asks for, measured as its worker measures: the drawing run once more here, in the page.
  const core = join(flow, '..', '..'), listed = JSON.parse(readFileSync(join(core, 'pack.json'), 'utf8')).layouts.find((d: any) => d.id === 'core.flow').modules;
  const modules = Object.fromEntries(Object.entries(listed).map(([n, f]) => [n, readFileSync(join(core, f as string), 'utf8')]));
  const got = await page.evaluate<{ input: any; scene: any; widths: Record<string, number>; again: any }>(`(async (modules) => {
    const urls = new Map();
    const urlOf = (name) => {
      if (urls.has(name)) return urls.get(name);
      const code = modules[name].replace(/(\\bfrom\\s*|\\bimport\\s*\\(?\\s*)(['"])\\.\\/([\\w.-]+\\.js)\\2/g, (_, b, q, dep) => b + q + urlOf(dep) + q);
      urls.set(name, URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      return urls.get(name);
    };
    const made = await import(urlOf('index.js'));
    const ctx = new OffscreenCanvas(1, 1).getContext('2d'), widths = {};
    const measure = (words, px, font, as) => {
      const said = as?.case === 'upper' ? String(words).toUpperCase() : String(words);
      const want = (as?.style === 'italic' ? 'italic ' : '') + (as?.weight === 600 ? 600 : 400) + ' ' + px + 'px ' + (font || 'system-ui'), key = want + '|' + said;
      if (widths[key] === undefined) { ctx.font = want; widths[key] = ctx.measureText(said).width; }
      const track = /^-?\\d+(\\.\\d+)?em$/.test(as?.track ?? '') ? parseFloat(as.track) * px * [...said].length : 0;
      return widths[key] + track;
    };
    const again = await made.picture(window.__start, { measure, patch() {}, open() {}, frame: () => new Promise(() => {}), surface: () => null });
    return { input: window.__start, scene: window.__scene, widths, again: JSON.parse(JSON.stringify(again?.scene ?? null)) };
  })(${JSON.stringify(modules)})`);
  page.close();
  const same = JSON.stringify(got.again) === JSON.stringify(got.scene);
  writeFileSync(join(home, `${name}.json`), JSON.stringify({ lens, width, height, input: got.input, widths: got.widths, scene: got.scene }));
  console.log(`Captured ${lens} at ${width} by ${height} as runs/flow-replay/${name}.json: ${Object.keys(got.widths).length} widths; drawn again in the page, ${same ? 'the same scene' : 'A DIFFERENT SCENE (the page drew with something this does not hold)'}`);
  if (!same) process.exitCode = 1;
}

/** The flow drawing's modules under the names it imports them by (the pack's `modules`), in a folder of their own. */
export function laidOutModules(core = join(flow, '..', '..')) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-replay-'));
  const listed = JSON.parse(readFileSync(join(core, 'pack.json'), 'utf8')).layouts.find((d: any) => d.id === 'core.flow').modules;
  for (const [n, f] of Object.entries(listed)) copyFileSync(join(core, f as string), join(dir, n));
  return dir;
}

/** The drawing on a kept input, in Node, measuring by the kept widths: its scene, and the texts it asked for that were not kept. */
export async function replay(name: string, dir = laidOutModules()) {
  const kept = JSON.parse(readFileSync(join(home, `${name}.json`), 'utf8'));
  const { picture } = await import(pathToFileURL(join(dir, 'index.js')).href);
  const missing = new Set<string>();
  const measure = (words: string, px: number, font: string, as: any) => {
    const { said, key } = keyOf(words, px, font, as);
    if (kept.widths[key] === undefined) missing.add(key);
    return (kept.widths[key] ?? 0) + track(said, px, as);
  };
  const drawn = await picture(kept.input, { measure, patch() {}, open() {}, frame: () => new Promise(() => {}), surface: () => null });
  return { kept, scene: plainScene(drawn?.scene), missing: [...missing] };
}

if (verb === 'capture') {
  const [lens, name, w, h, base] = rest;
  if (!lens) throw new Error('capture <lens id> [name] [width height] [server]');
  await capture(lens, name, w ? Number(w) : undefined, h ? Number(h) : undefined, base);
  process.exit();
} else if (verb === 'replay') {
  const { kept, scene, missing } = await replay(rest[0]);
  const same = JSON.stringify(scene) === JSON.stringify(kept.scene);
  console.log(same ? `${rest[0]}: drawn in Node, the same scene as the page's` : `${rest[0]}: drawn in Node, A DIFFERENT SCENE from the page's${missing.length ? ` (${missing.length} texts not measured, e.g. ${missing[0]})` : ''}`);
  process.exit(same ? 0 : 1);
}
