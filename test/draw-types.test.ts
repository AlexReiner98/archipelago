// The drawing contract as types (packs/walls/page/draw.d.ts), task e_p5s9br82: tsc with checkJs over a drawing's
// folder, as `map-code pull` writes one (the types beside a jsconfig.json), passes code that keeps to what draw.js and
// draw-inside.js hand over, and names a misspelt event.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const TYPES = join(import.meta.dirname, '..', 'packs', 'walls', 'page', 'draw.d.ts');
const TSC = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin', 'tsc');

/** The compiler options a pulled folder is checked with: drawings are loose JavaScript, so not strict. */
const JSCONFIG = {
  compilerOptions: { allowJs: true, checkJs: true, noEmit: true, strict: false, target: 'es2024', module: 'esnext', moduleResolution: 'bundler', allowImportingTsExtensions: true, lib: ['es2024', 'dom'], skipLibCheck: true, types: [] },
  include: ['*.js', '*.d.ts'],
};

/** tsc's report on a folder holding these modules, the types and the jsconfig. */
function check(modules: Record<string, string>): { ok: boolean; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'draw-types-'));
  try {
    copyFileSync(TYPES, join(dir, 'draw.d.ts'));
    writeFileSync(join(dir, 'jsconfig.json'), JSON.stringify(JSCONFIG));
    for (const [name, text] of Object.entries(modules)) writeFileSync(join(dir, name), text);
    const run = spawnSync(process.execPath, [TSC, '-p', 'jsconfig.json'], { cwd: dir, encoding: 'utf8' });
    return { ok: run.status === 0, out: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LAYOUT = `/** @param {import('./draw.d.ts').DrawInput} input */
export default function draw({ canvas, answer, style, theme, size, tree, on, open, tip, cursor, field, change, sandboxed, root, hot }) {
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.fillStyle = theme.dark ? theme.sea : theme.land;
  on('pointermove', (e) => tip(e.shift ? answer.items[0]?.title : null, e.x, e.y));
  on('pointerdown', (e) => e.button === 0 && open(answer.items[0].id));
  on('wheel', (e) => e.deltaY);
  on('field', (f) => f.done && change([{ op: 'create', type: 'task', title: f.value }], 'typed').then((came) => came.error ?? came.created));
  on('resize', (s) => ctx.fillRect(0, 0, s.width * size.dpr, size.height));
  on('answer', (a) => a.items.length);
  const kept = /** @type {{ zoom?: number } | undefined} */ (hot);
  cursor(kept?.zoom ? 'grab' : 'default');
  field('name', { x: 1, y: 2, width: 3, height: 4, placeholder: 'Name' });
  field('name', null);
  if (!sandboxed && root) root.textContent = String(style.title ?? '');
  return void tree().byId.get('e_00000000')?.kids.length;
}

/** @type {import('./draw.d.ts').Hot} */
export const hot = () => ({ zoom: 2 });
`;

const PICTURE = `/** @type {import('./draw.d.ts').PictureFn} */
export const picture = ({ answer, width, height, reduced, may }, { measure, patch, frame, gestures }) => {
  const add = gestures({ island: (key) => key === 'a' });
  frame().then((t) => patch([{ tip: null }]));
  return {
    scene: { svg: ['svg', { viewBox: \`0 0 \${width} \${height}\` }, ['text', { key: 'a', on: ['enter', 'click', ...add.on('a')] }, String(answer.items.length)]], size: { width, height: measure('x', 12) }, flat: reduced && may.includes('read') },
    on: (ev) => (ev.name === 'light' ? [] : [{ tip: { key: ev.key, mark: ['span', {}, 'hi'] } }]),
    viewport: (view) => [{ key: 'a', scale: view.scale }],
  };
};
`;

test('a drawing that keeps to the contract passes tsc', () => {
  const { ok, out } = check({ 'index.js': LAYOUT, 'picture.js': PICTURE });
  assert.ok(ok, out);
});

test('a misspelt event name is named by tsc', () => {
  const { ok, out } = check({ 'index.js': LAYOUT.replace("on('pointerdown'", "on('pointerdwn'") });
  assert.equal(ok, false);
  assert.match(out, /index\.js\(\d+,\d+\): error TS2345: Argument of type '"pointerdwn"'/);
});

test("a mark's unknown event is named by tsc", () => {
  const { ok, out } = check({ 'picture.js': PICTURE.replace("on: ['enter',", "on: ['hover',") });
  assert.equal(ok, false);
  assert.match(out, /picture\.js\(\d+,\d+\): error/);
});
