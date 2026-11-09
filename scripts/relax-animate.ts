// The relaxation (step 3, task e_7et8f4uv) played round by round: a shape in step 2's format relaxed, every round it
// tells kept, and one page written that plays them, the grid's sketch first. For the owner to watch how a picture is
// made before it is drawn in the page.
//   node scripts/relax-animate.ts [sketch name | <view>.sketch.json] [out.html]
// A sketch step 2 wrote (runs/shape/<view>.sketch.json) is sized by the kit's model of the flow replay of the same
// view (runs/flow-replay/<view>.json, in this checkout or the main one), as step 1 read it.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as sketches from '../test/relax-sketches.ts';
import { drawings, setOut } from '../test/wired.ts';

const strips = drawings.find((d) => d.id === 'core.strips')!;
const RELAX = { pack: 'core', id: 'relax', modules: { ...strips.modules, 'relax.js': 'layouts/relax/relax.js', 'atoms.js': 'layouts/relax/atoms.js', 'order.js': 'layouts/relax/order.js', 'solve.js': 'layouts/relax/solve.js' } };
const ROOT = join(import.meta.dirname, '..');
const house = JSON.parse(readFileSync(join(ROOT, 'packs/core/pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props, sizes = house.sizes;
// RELAX="unit=20,hold=0.2" tries other sizes of the relaxation than the house style's.
for (const kv of (process.env.RELAX ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); sizes[`relax_${k}`] = Number(v); }
const [what = 'map', out = join(ROOT, 'runs', 'relax.html')] = process.argv.slice(2);
const shape = what.endsWith('.json') ? JSON.parse(readFileSync(what, 'utf8')) : (sketches as any)[what]();
const view = basename(what).replace(/\.sketch\.json$/, ''), common = join(execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd: ROOT }).toString().trim(), '..');
const replay = [join(ROOT, 'runs', 'flow-replay', `${view}.json`), join(common, 'runs', 'flow-replay', `${view}.json`)].find((p) => what.endsWith('.json') && existsSync(p));
/** Titles by id, for the drawing, where the view's replay names them. */
const titles = new Map<string, string>();

const rounds: any[] = await setOut(RELAX, async (url) => {
  const { relax } = await import(url('relax.js')), { stages } = await import(url('stage.js'));
  let size = (n: any) => (n.w ? [n.w * 30, 34] : [0, 0]);
  if (replay) {
    // Each step as the flow sizes it, measured roughly as step 1 measured it.
    const { model } = await import(url('model.js')), { answer, style } = JSON.parse(readFileSync(replay, 'utf8')).input;
    const m = model({ items: answer.items, links: answer.links ?? [], undrawn: style.undrawn ?? [], headless: style.headless ?? [], measure: (t: string, px: number) => String(t).length * px * 0.55, sizes: { ...sizes, ...style.sizes } });
    for (const i of answer.items) titles.set(i.id, i.title);
    size = (n: any) => (m.nodes.has(n.id) ? [m.nodes.get(n.id).w, m.nodes.get(n.id).h] : n.kind === 'item' ? [n.w * 30, 34] : [0, 0]);
  }
  const told: any[] = [];
  stages((name: string, s: any) => name === 'relax' && told.push(s));
  const done = relax(shape, { size, sizes });
  stages(null);
  console.log(`${told.length} rounds told; ${JSON.stringify(done.told)}`);
  return told;
});

const lens = replay ? JSON.parse(readFileSync(replay, 'utf8')).lens : null;
// NAME="How is Archipelago built" names the view, which its replay keeps only by id.
const heading = replay ? `${process.env.NAME ?? lens ?? view}: the relaxation, round by round` : 'Step 3: the relaxation, round by round';
const said = replay
  ? `Step 2's shape of this view (its grid keeps each stretch's way and the order of everything) relaxed in one solve: wires pulled short, ends toward the middles of their sides, boxes grown only where what passes them needs it, islands a sea apart. Every distance is kept and no crossing changes.`
  : 'A hand-made shape on a grid (a ring with a wire up, a trunk, a dense box, two islands joined through ports) relaxed in one solve: wires pulled short, ends toward the middles of their sides, every distance and the order of what sees what kept.';
const page = `<title>${replay ? `${process.env.NAME ?? view}, relaxed` : 'Relaxation rounds'}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* One drawing, a bar of controls over it: a sketch on a grid relaxed round by round. */
:root { --bg: #f6f7f5; --paper: #ffffff; --ink: #1f2623; --muted: #66706b; --line: #4d5852; --isle: #e3eee6; --shore: #93b29c; --port: #2f6fb5; --knot: #b9452f;
  --ui: system-ui, -apple-system, "Segoe UI", sans-serif; --mono: ui-monospace, "Cascadia Mono", Menlo, monospace }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #151917; --paper: #1d2320; --ink: #e4ebe7; --muted: #94a19a; --line: #b3c0b9; --isle: #233129; --shore: #4f7a5d; --port: #6fa6e8; --knot: #e57b63; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #151917; --paper: #1d2320; --ink: #e4ebe7; --muted: #94a19a; --line: #b3c0b9; --isle: #233129; --shore: #4f7a5d; --port: #6fa6e8; --knot: #e57b63; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 14px/1.5 var(--ui); padding-block: 16px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)) }
h1 { font-size: 17px; margin: 0 0 4px; text-wrap: balance }
p { margin: 0 0 12px; color: var(--muted); max-width: 65ch }
#bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 10px }
#at { flex: 1 1 240px; min-width: 0; accent-color: var(--port) }
#n { font: 12px var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; min-width: 22ch }
button { font: inherit; padding: 4px 14px; border: 1px solid var(--line); background: var(--paper); color: var(--ink); border-radius: 4px; cursor: pointer }
button:focus-visible, #at:focus-visible { outline: 2px solid var(--port); outline-offset: 2px }
.frame { overflow-x: auto; background: var(--paper); border: 1px solid var(--shore) }
svg { display: block; width: 100%; height: auto; min-width: 560px }
.box { fill: var(--paper); stroke: var(--ink) } .dot { fill: var(--knot) } .port { fill: var(--port) }
.wire { fill: none; stroke: var(--line); stroke-width: 1.25 } .up { stroke-dasharray: 5 4 }
.isle { fill: var(--isle); stroke: var(--shore) } text { font: 11px var(--ui); fill: var(--ink) }
</style>
<h1>${heading}</h1>
<p>${said}</p>
<div id="bar"><button id="play">Play</button><input id="at" type="range" min="0" max="${rounds.length - 1}" value="0" aria-label="Round"><span id="n"></span></div>
<div class="frame"><svg id="s"></svg></div>
<script>
const R = ${JSON.stringify(rounds)};
const T = ${JSON.stringify(Object.fromEntries(titles))};
const W = Math.max(...R.flatMap(r => [...r.nodes.map(n => n.x + n.w / 2), ...r.islands.map(i => i.rect[2]), ...r.wires.flatMap(w => w.points.map(p => p[0]))])) + 40;
const H = Math.max(...R.flatMap(r => [...r.nodes.map(n => n.y + n.h / 2), ...r.islands.map(i => i.rect[3]), ...r.wires.flatMap(w => w.points.map(p => p[1]))])) + 40;
const s = document.getElementById('s'); s.setAttribute('viewBox', \`-20 -20 \${W} \${H}\`);
function draw(k) {
  const r = R[k]; document.getElementById('n').textContent = { grid: 'the grid', room: 'room given', relax: \`round \${r.round}\`, kept: \`round \${r.round}, every distance kept\` }[r.phase];
  s.innerHTML = r.islands.map(i => \`<rect class="isle" x="\${i.rect[0]}" y="\${i.rect[1]}" width="\${i.rect[2]-i.rect[0]}" height="\${i.rect[3]-i.rect[1]}" rx="12"/><text x="\${i.rect[0]+8}" y="\${i.rect[1]+14}">\${i.id}</text>\`).join('')
    + r.wires.map(w => \`<polyline class="wire\${w.reversed ? ' up' : ''}" points="\${w.points.map(p => p.join(',')).join(' ')}"/>\`).join('')
    + r.nodes.map(n => n.w ? \`<rect class="box" x="\${n.x-n.w/2}" y="\${n.y-n.h/2}" width="\${n.w}" height="\${n.h}" rx="6"/><text x="\${n.x}" y="\${n.y+4}" text-anchor="middle">\${(T[n.id] ?? n.id).slice(0, Math.max(3, Math.floor(n.w / 6.5)))}</text>\` : \`<circle class="\${n.kind === 'port' ? 'port' : 'dot'}" cx="\${n.x}" cy="\${n.y}" r="3"/>\`).join('');
}
const at = document.getElementById('at'); at.oninput = () => draw(+at.value);
let timer = null;
document.getElementById('play').onclick = () => { clearInterval(timer); at.value = 0; draw(0); timer = setInterval(() => { if (+at.value >= R.length - 1) return clearInterval(timer); at.value = +at.value + 1; draw(+at.value); }, ${80}); };
draw(0);
</script>`;
writeFileSync(out, page);
console.log(`written ${out}`);
