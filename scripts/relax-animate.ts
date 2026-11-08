// The relaxation (step 3, task e_7et8f4uv) played round by round: a shape in step 2's format relaxed, every round it
// tells kept, and one page written that plays them, the grid's sketch first. For the owner to watch how a picture is
// made before it is drawn in the page.
//   node scripts/relax-animate.ts [sketch name | shape.json] [out.html]

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as sketches from '../test/relax-sketches.ts';
import { setOut } from '../test/wired.ts';

const RELAX = { pack: 'core', id: 'relax', modules: { 'relax.js': 'layouts/relax/relax.js', 'atoms.js': 'layouts/relax/atoms.js', 'order.js': 'layouts/relax/order.js', 'solve.js': 'layouts/relax/solve.js', 'stage.js': 'layouts/kit/stage.js' } };
const ROOT = join(import.meta.dirname, '..');
const sizes = JSON.parse(readFileSync(join(ROOT, 'packs/core/pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props.sizes;
// RELAX="unit=20,hold=0.2" tries other sizes of the relaxation than the house style's.
for (const kv of (process.env.RELAX ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); sizes[`relax_${k}`] = Number(v); }
const [what = 'map', out = join(ROOT, 'runs', 'relax.html')] = process.argv.slice(2);
const shape = what.endsWith('.json') ? JSON.parse(readFileSync(what, 'utf8')) : (sketches as any)[what]();
const size = (n: any) => (n.w ? [n.w * 30, 34] : [0, 0]);

const rounds: any[] = await setOut(RELAX, async (url) => {
  const { relax } = await import(url('relax.js')), { stages } = await import(url('stage.js'));
  const told: any[] = [];
  stages((name: string, s: any) => name === 'relax' && told.push(s));
  const done = relax(shape, { size, sizes });
  stages(null);
  console.log(`${told.length} rounds told; ${JSON.stringify(done.told)}`);
  return told;
});

const page = `<!doctype html><meta charset="utf-8"><title>Relaxation</title>
<style>body{font:13px system-ui;margin:16px;background:#fbfaf7;color:#222}svg{background:#fff;border:1px solid #ddd}
.box{fill:#fff;stroke:#333}.dot{fill:#c33}.port{fill:#36c}.wire{fill:none;stroke:#555;stroke-width:1.25}.up{stroke-dasharray:5 4}
.isle{fill:#e8f1ea;stroke:#9bb8a2}text{font-size:11px;fill:#333}#bar{display:flex;gap:12px;align-items:center;margin-bottom:8px}</style>
<div id="bar"><button id="play">Play</button><input id="at" type="range" min="0" max="${rounds.length - 1}" value="0" style="width:420px"><span id="n"></span></div>
<svg id="s"></svg>
<script>
const R = ${JSON.stringify(rounds)};
const W = Math.max(...R.flatMap(r => [...r.nodes.map(n => n.x + n.w / 2), ...r.islands.map(i => i.rect[2]), ...r.wires.flatMap(w => w.points.map(p => p[0]))])) + 40;
const H = Math.max(...R.flatMap(r => [...r.nodes.map(n => n.y + n.h / 2), ...r.islands.map(i => i.rect[3]), ...r.wires.flatMap(w => w.points.map(p => p[1]))])) + 40;
const s = document.getElementById('s'); s.setAttribute('viewBox', \`-20 -20 \${W} \${H}\`); s.setAttribute('width', Math.min(W, 1400));
function draw(k) {
  const r = R[k]; document.getElementById('n').textContent = { grid: 'the grid', room: 'room given', relax: \`round \${r.round}\`, kept: \`round \${r.round}, every distance kept\` }[r.phase];
  s.innerHTML = r.islands.map(i => \`<rect class="isle" x="\${i.rect[0]}" y="\${i.rect[1]}" width="\${i.rect[2]-i.rect[0]}" height="\${i.rect[3]-i.rect[1]}" rx="12"/><text x="\${i.rect[0]+8}" y="\${i.rect[1]+14}">\${i.id}</text>\`).join('')
    + r.wires.map(w => \`<polyline class="wire\${w.reversed ? ' up' : ''}" points="\${w.points.map(p => p.join(',')).join(' ')}"/>\`).join('')
    + r.nodes.map(n => n.w ? \`<rect class="box" x="\${n.x-n.w/2}" y="\${n.y-n.h/2}" width="\${n.w}" height="\${n.h}" rx="6"/><text x="\${n.x}" y="\${n.y+4}" text-anchor="middle">\${n.id}</text>\` : \`<circle class="\${n.kind === 'port' ? 'port' : 'dot'}" cx="\${n.x}" cy="\${n.y}" r="3"/>\`).join('');
}
const at = document.getElementById('at'); at.oninput = () => draw(+at.value);
let timer = null;
document.getElementById('play').onclick = () => { clearInterval(timer); at.value = 0; draw(0); timer = setInterval(() => { if (+at.value >= R.length - 1) return clearInterval(timer); at.value = +at.value + 1; draw(+at.value); }, ${80}); };
draw(0);
</script>`;
writeFileSync(out, page);
console.log(`written ${out}`);
