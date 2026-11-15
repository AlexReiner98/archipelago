// A drawing baked once, as an SVG a published page shows with nothing running (task e_muh2979u). Its code painted each
// of its pictures on a canvas that keeps shapes (packs/walls/page/draw-record.js); here the pictures, the same shapes in
// other colours, become one: each fill and line names its slot, and each picture is the colours its slots take, turned
// by the SVG's own stylesheet (task e_bx7wrpn6). The SVG is written from numbers, checked colours and escaped words
// alone, never from markup the code wrote (task e_bmeby2vu).

type Point = [number, number];
type Step = [string, ...Point[]];
export interface Shape {
  k: 'fill' | 'stroke' | 'text';
  d?: Step[];
  c: string;
  a: number;
  w?: number;
  j?: string;
  cap?: string;
  clip: number;
  m?: number[];
  s?: string;
  font?: string;
  align?: string;
  base?: string;
  sp?: string;
}
export interface Picture {
  width: number;
  height: number;
  clips: { d: Step[]; up: number }[];
  shapes: Shape[];
}
export interface Timing {
  every: number;
  fade: boolean;
}

/** One picture whose colours are slots, and what each slot is in each picture, in the order they turn. */
export interface Slotted {
  width: number;
  height: number;
  clips: Picture['clips'];
  shapes: (Shape & { slot: number })[];
  names: string[];
  slots: string[][];
  timing: Timing;
}

const COLOUR = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\))$/;
const STEP = new Set(['M', 'L', 'C', 'Q', 'Z']);
/** The most a baked picture may say: its shapes, and the steps of all their outlines. */
const MOST_SHAPES = 200000;
const MOST_STEPS = 2000000;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e7;
function checkSteps(d: unknown, where: string): Step[] {
  if (!Array.isArray(d)) throw new Error(`${where}: an outline is a list of steps`);
  for (const step of d) {
    if (!Array.isArray(step) || !STEP.has(step[0]) || !step.slice(1).every((p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))) throw new Error(`${where}: a step is a letter and points`);
  }
  return d as Step[];
}

/** A picture as the frame sent it, checked: numbers, colours of the two forms a canvas says, and words. */
export function checkPicture(p: unknown, name: string): Picture {
  const pic = p as Picture;
  if (!pic || !finite(pic.width) || !finite(pic.height) || pic.width <= 0 || pic.height <= 0) throw new Error(`${name}: a picture has a size`);
  if (!Array.isArray(pic.shapes) || pic.shapes.length > MOST_SHAPES) throw new Error(`${name}: a picture holds at most ${MOST_SHAPES} shapes`);
  if (!Array.isArray(pic.clips)) throw new Error(`${name}: a picture's clips are a list`);
  for (const [i, c] of pic.clips.entries()) {
    checkSteps(c?.d, `${name}, clip ${i + 1}`);
    if (!Number.isInteger(c.up) || c.up < 0 || c.up > i) throw new Error(`${name}, clip ${i + 1}: a clip is inside one before it, or none`);
  }
  let steps = 0;
  for (const [i, s] of pic.shapes.entries()) {
    const where = `${name}, shape ${i + 1}`;
    if (!['fill', 'stroke', 'text'].includes(s?.k)) throw new Error(`${where}: a shape is a fill, a line or words`);
    if (typeof s.c !== 'string' || !COLOUR.test(s.c)) throw new Error(`${where}: its colour is not one a canvas says`);
    if (!finite(s.a) || !Number.isInteger(s.clip) || s.clip < 0 || s.clip > pic.clips.length) throw new Error(`${where}: its opacity or clip is not a number it may be`);
    if (s.k === 'text') {
      if (typeof s.s !== 'string' || !Array.isArray(s.m) || s.m.length !== 6 || !s.m.every(finite)) throw new Error(`${where}: words need their text and where they stand`);
    } else steps += checkSteps(s.d, where).length;
    if (s.k === 'stroke' && !finite(s.w)) throw new Error(`${where}: a line has a width`);
  }
  if (steps > MOST_STEPS) throw new Error(`${name}: a picture's outlines take at most ${MOST_STEPS} steps`);
  return pic;
}

/** What a shape is, but for its colour: two pictures turn into each other only where these are the same. */
const form = (s: Shape) => JSON.stringify([s.k, s.d, s.w, s.j, s.cap, s.a, s.clip, s.m, s.s, s.font, s.align, s.base, s.sp]);

/**
 * The pictures of one baking as one: every picture must hold the same shapes, in the same order, in their colours
 * alone; each shape's colours across the pictures are its slot, shapes that turn alike sharing one.
 */
export function slotted(pictures: Record<string, unknown>, timing: Partial<Timing> = {}): Slotted {
  const names = Object.keys(pictures);
  if (!names.length) throw new Error('A baking holds at least one picture');
  const pics = names.map((n) => checkPicture(pictures[n], n));
  const [first] = pics;
  for (const [i, p] of pics.entries()) {
    if (p.width !== first.width || p.height !== first.height || p.shapes.length !== first.shapes.length || JSON.stringify(p.clips) !== JSON.stringify(first.clips)) throw new Error(`${names[i]} is not the same picture as ${names[0]} in other colours`);
  }
  const slotOf = new Map<string, number>();
  const slots: string[][] = [];
  const shapes = first.shapes.map((s, j) => {
    const at = form(s);
    const colours = pics.map((p, i) => {
      if (form(p.shapes[j]) !== at) throw new Error(`${names[i]} differs from ${names[0]} at shape ${j + 1}: a baked picture turns its colours alone`);
      return p.shapes[j].c;
    });
    const key = colours.join(' ');
    if (!slotOf.has(key)) (slotOf.set(key, slots.length), slots.push(colours));
    return { ...s, slot: slotOf.get(key)! };
  });
  const every = Math.max(0.2, Math.min(60, Number(timing.every) || 1));
  return { width: first.width, height: first.height, clips: first.clips, shapes, names, slots, timing: { every, fade: timing.fade === true } };
}

// ---- the SVG, written from the checked shapes alone ----

const num = (n: number) => String(Math.round(n * 10) / 10);
/** An outline as path data, each point after the first said from the one before, which keeps it small. */
function pathData(d: Step[]): string {
  let x = 0, y = 0, out = '';
  for (const [k, ...pts] of d) {
    if (k === 'Z') { out += 'z'; continue; }
    out += k === 'M' ? 'M' : k.toLowerCase();
    if (k === 'M') ([x, y] = pts[0], (out += `${num(x)} ${num(y)}`));
    else {
      out += pts.map(([px, py]) => `${num(px - x)} ${num(py - y)}`).join(' ');
      [x, y] = pts.at(-1)!;
    }
    // A rounded point said from a rounded one: the next is said from where this one is drawn, so nothing drifts.
    [x, y] = [Number(num(x)), Number(num(y))];
  }
  return out.replace(/ -/g, '-');
}
const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');
/** A font as a canvas says it, kept only to letters, numbers, spaces and the marks a font names with. */
const fontOf = (f = '') => f.replace(/[^\w\s.,'"%-]/g, '').slice(0, 120);
const ANCHOR: Record<string, string> = { start: 'start', left: 'start', center: 'middle', end: 'end', right: 'end' };
const BASELINE: Record<string, string> = { top: 'hanging', hanging: 'hanging', middle: 'central', alphabetic: 'auto', ideographic: 'text-after-edge', bottom: 'text-after-edge' };

/** Each slot's colour in turn: held for `every` seconds, and cut, or eased in over the last part of its time. */
function turning(slots: string[][], { every, fade }: Timing): string {
  const n = slots[0]?.length ?? 1;
  const total = every * n;
  const pc = (t: number) => `${Math.round((t / n) * 100000) / 1000}%`;
  const rules: string[] = [];
  const how = `${total}s ${fade ? 'linear' : 'step-end'} infinite`;
  slots.forEach((colours, i) => {
    const still = n < 2 || colours.every((c) => c === colours[0]);
    for (const [cls, prop] of [['f', 'fill'], ['l', 'stroke']]) {
      if (still) {
        rules.push(`.${cls}${i}{${prop}:${colours[0]}}`);
        continue;
      }
      const frames = colours.map((c, j) => (fade ? `${pc(j)},${pc(j + 0.6)}{${prop}:${c}}` : `${pc(j)}{${prop}:${c}}`)).join('');
      rules.push(`@keyframes ${cls}${i}{${frames}${fade ? `100%{${prop}:${colours[0]}}` : ''}}.${cls}${i}{${prop}:${colours[0]};animation:${cls}${i} ${how}}`);
    }
  });
  // Asked for less motion, the first picture holds.
  rules.push('@media (prefers-reduced-motion:reduce){*{animation:none!important}}');
  return rules.join('');
}

/** The baked picture as one SVG: its clips, each shape in its slot's class, and the stylesheet that turns them. */
export function bakedSvg(b: Slotted): string {
  const clips = b.clips.map((c, i) => `<clipPath id="c${i + 1}"${c.up ? ` clip-path="url(#c${c.up})"` : ''}><path d="${pathData(c.d)}"/></clipPath>`).join('');
  const body: string[] = [];
  const clip = (n: number) => (n ? ` clip-path="url(#c${n})"` : '');
  const alpha = (a: number, prop: string) => (a < 1 ? ` ${prop}="${Math.round(Math.max(0, a) * 1000) / 1000}"` : '');
  for (let i = 0; i < b.shapes.length; i++) {
    const s = b.shapes[i];
    if (s.k === 'text') {
      const m = s.m!.map((v) => Math.round(v * 1000) / 1000).join(' ');
      const style = `font:${fontOf(s.font)}${s.sp && /^-?\d+(\.\d+)?(px|em)$/.test(s.sp) && s.sp !== '0px' ? `;letter-spacing:${s.sp}` : ''}`;
      // A clip on an element with a transform is read in that transform: words are clipped by a group around them.
      const text = `<text class="f${s.slot}" transform="matrix(${m})" text-anchor="${ANCHOR[s.align ?? 'start'] ?? 'start'}" dominant-baseline="${BASELINE[s.base ?? 'alphabetic'] ?? 'auto'}" style="${escapeAttr(style)}"${alpha(s.a, 'fill-opacity')}>${escapeText(s.s!)}</text>`;
      body.push(s.clip ? `<g${clip(s.clip)}>${text}</g>` : text);
      continue;
    }
    // A fill and the line drawn round the same outline after it are one shape.
    const next = b.shapes[i + 1];
    const both = s.k === 'fill' && next?.k === 'stroke' && next.clip === s.clip && next.a === s.a && JSON.stringify(next.d) === JSON.stringify(s.d);
    const line = s.k === 'stroke' ? s : both ? next : null;
    const cls = [s.k === 'fill' ? `f${s.slot}` : '', line ? `l${line.slot}` : ''].filter(Boolean).join(' ');
    const lineAttrs = line ? ` stroke-width="${num(line.w!)}"${line.j && line.j !== 'miter' ? ` stroke-linejoin="${line.j}"` : ''}${line.cap && line.cap !== 'butt' ? ` stroke-linecap="${line.cap}"` : ''}` : '';
    body.push(`<path class="${cls}" d="${pathData(s.d!)}"${s.k === 'stroke' ? ' fill="none"' : ''}${lineAttrs}${alpha(s.a, 'opacity')}${clip(s.clip)}/>`);
    if (both) i++;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(b.width)} ${num(b.height)}"><style>${turning(b.slots, b.timing)}</style>${clips ? `<defs>${clips}</defs>` : ''}${body.join('')}</svg>`;
}
