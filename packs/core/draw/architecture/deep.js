// The islands as a relief map (a step's look "islands_3d"), painted with three.js on the surface the page lays over
// the picture (tools.surface). One tile of ground: the sea floor, deeper away from land, under clear water, and each
// island a mountain whose shore is its flat outline, with a contour at every level, one level for each piece of work
// inside it. The levels are coloured from the shore up as that work is done, and bare above. It comes in seen from
// straight above, where it is a map of the flat picture, then the eye tilts down while the land rises out of the sea,
// and follows the work: closer, lower and round to the side of the islands under way, back to the whole map at the end.
// Routes lie on the water, in the accent while a step lights them, with what they carry beside them; each island's
// name stands over its peak. Where the page gives no surface (a still picture drawn on the server, no WebGL), the
// flat islands stay. Every height, angle and time is the style's (arch_deep_*), every colour its theme's (relief_*).

import { hashOf } from './islands.js';

/** The look drawn here. */
export const LOOK = 'islands_3d';

export const css = `
.lf-surface { opacity: 0; transition: opacity 0.6s ease; }
.lf-surface.sp-on { opacity: 1; }
svg.sp-deep { visibility: hidden; }
`;

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Noise that varies smoothly over the plane, the same for the same seed every time. */
function noiseOf(seed) {
  const s = Math.floor(hashOf(seed) * 1e9);
  const at = (x, y) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ s;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const one = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const [a, b, c, d] = [at(ix, iy), at(ix + 1, iy), at(ix, iy + 1), at(ix + 1, iy + 1)];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y) => one(x, y) * 0.55 + one(x * 2.1, y * 2.1) * 0.3 + one(x * 4.3, y * 4.3) * 0.15;
}

/** How a fragment of ground is coloured: by its depth under the sea, else by its height on its island and how far up that island's work is done. */
const GROUND = `
float depth = clamp(-vH / uFloor, 0.0, 1.0), sl = max(-vH, 0.0) / uSeaStep;
vec3 sea = mix(uShallow, uDeep, depth) * (1.0 - 0.12 * (1.0 - smoothstep(0.0, fwidth(sl) * 1.2, fract(sl))) * step(0.0, -vH));
int k = clamp(int(vOwner + 0.5), 0, 15);
float t = clamp(vH / uPeak[k], 0.0, 1.0), lv = t * uLevels[k];
vec3 land = t < 0.35 ? mix(uLow, uMid, t / 0.35) : t < 0.75 ? mix(uMid, uHigh, (t - 0.35) / 0.4) : mix(uHigh, uTop, (t - 0.75) / 0.25);
land = mix(uBare, land, step(lv, uDone[k] * uLevels[k] + 0.0001));
land *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, fwidth(lv) * 1.5, fract(lv)));
// The shore drawn smooth, whatever the size of the ground's cells.
float edge = max(fwidth(vH), 0.0001);
diffuseColor.rgb = mix(sea, land, smoothstep(-edge, edge, vH));
`;

/**
 * The relief of a story, played step by step: `go(f, dur)` shows frame f (in relief if its look is this one, else the
 * flat picture again). `shape` is what story.js knows of each frame: where its parts, wires and words are.
 */
export function deep({ style, tools, z, num, shape }) {
  const { partAt, wireAt, saysAt, view, valueOf, dotsOf, shift } = shape;
  let world = null, on = false, want = null;
  const built = () => (world ??= make().catch((err) => (console.warn(`The islands in 3D could not be drawn: ${err?.message ?? err}`), null)));

  async function make() {
    const surface = await tools.surface?.();
    if (!surface) return null;
    const THREE = await surface.three();
    const { page, lens } = surface.colours;
    const colour = (...names) => new THREE.Color(names.map((n) => page[n] ?? lens[n]).find(Boolean) || 'gray');
    const renderer = new THREE.WebGLRenderer({ canvas: surface.canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    let size = surface.size;
    const fitRenderer = () => (renderer.setPixelRatio(size.dpr), renderer.setSize(size.width, size.height, false));
    fitRenderer();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(num('arch_deep_fov'), size.width / Math.max(1, size.height), 1, 1e5);
    // White light from the sky and the sun, and the water's colour from below.
    scene.add(new THREE.HemisphereLight(new THREE.Color(1, 1, 1), colour('relief_deep', 'accent_soft'), 1.2));
    const sun = new THREE.DirectionalLight(new THREE.Color(1, 1, 1), 1.9);
    scene.add(sun, sun.target);

    // Words as pictures that face the eye, as large as the flat picture draws them: a pill, a dot, the words.
    const R = 4;
    const words = (text, px, { fg, bg, edge, dot, weight = 500 }) => {
      const c = new OffscreenCanvas(1, 1), g = c.getContext('2d');
      const font = `${weight} ${px * R}px ${style.font || 'system-ui'}`;
      g.font = font;
      const pad = px * 0.55 * R, high = px * 1.6 * R, dr = dot ? px * 0.3 * R : 0, gap = dot ? px * 0.5 * R : 0;
      c.width = Math.ceil(g.measureText(text).width + 2 * pad + (dot ? 2 * dr + gap : 0));
      c.height = Math.ceil(high);
      g.font = font;
      g.fillStyle = bg;
      g.strokeStyle = edge;
      g.lineWidth = R;
      g.beginPath();
      g.roundRect(R / 2, R / 2, c.width - R, c.height - R, (c.height - R) / 2);
      g.fill();
      g.stroke();
      if (dot) ((g.fillStyle = dot), g.beginPath(), g.arc(pad + dr, c.height / 2, dr, 0, Math.PI * 2), g.fill());
      g.fillStyle = fg;
      g.textBaseline = 'middle';
      g.fillText(text, pad + (dot ? 2 * dr + gap : 0), c.height / 2 + R / 2);
      const map = new THREE.CanvasTexture(c);
      map.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false }));
      sprite.scale.set(c.width / R, c.height / R, 1);
      sprite.renderOrder = 2;
      return sprite;
    };
    const swap = (sprite, made) => (sprite.material.map.dispose(), (sprite.material.map = made.material.map), sprite.scale.copy(made.scale));
    const hex = (c) => `#${c.getHexString()}`;
    const dotColour = (n, f) => colour(dotsOf(f.look)?.colours?.[valueOf(n, f.look)], 'done');
    const nameOf = (title, n, f) => words(title, z('text'), { fg: page.text || lens.text, bg: page.panel || lens.land, edge: lens.line, dot: hex(dotColour(n, f)) });

    // How far up each island is coloured: the share of the work in it that is done; with none in it, its own status.
    const order = (f) => dotsOf(f.look)?.order ?? [];
    const doneOf = (n, f) => {
      const last = order(f).at(-1), inside = n.notes ?? [];
      const finished = (item) => (last ? item.status === last : ['done', 'up'].includes(item.status));
      if (inside.length) return inside.filter(finished).length / inside.length;
      const at = order(f).indexOf(valueOf(n, f.look));
      return at < 0 ? (n.health === 'ok' ? 1 : 0) : at / Math.max(1, order(f).length - 1);
    };

    // ---- The ground: made once, from the first frame drawn in relief, which places the islands as every later one does.
    const MOST = 16;
    const uniforms = {
      uPeak: { value: new Array(MOST).fill(1) },
      uLevels: { value: new Array(MOST).fill(1) },
      uDone: { value: new Array(MOST).fill(0) },
      uFloor: { value: z('deep_floor') },
      uSeaStep: { value: z('deep_floor') / 4 },
      uShallow: { value: colour('relief_shallow', 'accent_soft') },
      uDeep: { value: colour('relief_deep', 'accent') },
      uBare: { value: colour('relief_bare', 'closed_soft') },
      uLow: { value: colour('relief_low', 'ok') },
      uMid: { value: colour('relief_mid', 'warn_soft') },
      uHigh: { value: colour('relief_high', 'warn') },
      uTop: { value: colour('relief_top', 'panel') },
    };
    let tile = null, peakMost = 0;
    const islands = new Map(), routes = new Map();
    const ground = (f) => {
      const [x0, y0, w, h] = view(f.g).split(' ').map(Number);
      tile = [x0, y0, w, h];
      const floor = z('deep_floor'), noise = noiseOf('sea'), rough = noiseOf('land'), wob = num('arch_island_wobble');
      const list = [...f.parts].slice(0, MOST).map(([id, n], k) => {
        const r = f.g.radii.get(id), levels = Math.max(1, (n.notes ?? []).length);
        const peak = z('deep_high') * (0.75 + 0.1 * Math.min(levels, 4)) * (0.85 + 0.3 * hashOf(id));
        uniforms.uPeak.value[k] = peak;
        uniforms.uLevels.value[k] = levels;
        uniforms.uDone.value[k] = doneOf(n, f);
        peakMost = Math.max(peakMost, peak);
        return { id, k, n, cx: n.x0 + shift, cy: n.y0, rx: r.rx, ry: r.ry, peak, phase: [0, 1, 2].map((m) => hashOf(`${id}:${m}`) * Math.PI * 2) };
      });
      // The height of the ground at x, y (the flat picture's), and the island it is nearest.
      const heightAt = (x, y) => {
        let best = -Infinity, owner = -1;
        for (const i of list) {
          const dx = (x - i.cx) / i.rx, dy = (y - i.cy) / i.ry, a = Math.atan2(dy, dx);
          const shore = 1 + wob * (0.5 * Math.sin(3 * a + i.phase[0]) + 0.3 * Math.sin(5 * a + i.phase[1]) + 0.2 * Math.sin(2 * a + i.phase[2]));
          const d = Math.hypot(dx, dy) / shore;
          const v = d < 1 ? i.peak * Math.pow(Math.cos((d * Math.PI) / 2), 1.25) * (0.78 + 0.44 * rough(x / 38, y / 38)) : -floor * smooth(1, 2.6, d);
          if (v > best) ((best = v), (owner = i.k));
        }
        // Under the sea too, the ground is its nearest island's, so its colour does not change at the shore.
        const sea = -floor * (0.8 + 0.4 * noise(x / 160, y / 160));
        return [Math.max(best, sea), owner];
      };
      const nx = 320, ny = Math.max(2, Math.round((nx * h) / w));
      const geo = new THREE.PlaneGeometry(w, h, nx, ny).rotateX(-Math.PI / 2).translate(x0 + w / 2, 0, y0 + h / 2);
      const pos = geo.attributes.position, owners = new Float32Array(pos.count);
      for (let v = 0; v < pos.count; v++) {
        const [hgt, owner] = heightAt(pos.getX(v), pos.getZ(v));
        pos.setY(v, hgt);
        owners[v] = owner;
      }
      geo.setAttribute('owner', new THREE.BufferAttribute(owners, 1));
      geo.computeVertexNormals();
      const paint = new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide });
      paint.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float owner;\nvarying float vOwner;\nvarying float vH;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOwner = owner;\nvH = position.y;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying float vOwner;\nvarying float vH;\nuniform float uPeak[${MOST}];\nuniform float uLevels[${MOST}];\nuniform float uDone[${MOST}];\nuniform float uFloor;\nuniform float uSeaStep;\nuniform vec3 uShallow, uDeep, uBare, uLow, uMid, uHigh, uTop;`)
          .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND}`);
      };
      const land = new THREE.Mesh(geo, paint);
      // The tile's sides: the ground cut through down to its base, and the water over it where the ground is under it.
      const base = -floor * 1.7;
      const edges = [
        [...Array(nx + 1).keys()].map((i) => i),
        [...Array(nx + 1).keys()].map((i) => ny * (nx + 1) + i),
        [...Array(ny + 1).keys()].map((j) => j * (nx + 1)),
        [...Array(ny + 1).keys()].map((j) => j * (nx + 1) + nx),
      ];
      const side = (top, bottom, material) => {
        const g = new THREE.BufferGeometry(), at = [], index = [];
        edges.forEach((edge) => {
          const start = at.length / 3;
          for (const v of edge) at.push(pos.getX(v), top(pos.getY(v)), pos.getZ(v), pos.getX(v), bottom(pos.getY(v)), pos.getZ(v));
          for (let i = 0; i < edge.length - 1; i++) {
            const a = start + 2 * i;
            index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        });
        g.setAttribute('position', new THREE.Float32BufferAttribute(at, 3));
        g.setIndex(index);
        g.computeVertexNormals();
        return new THREE.Mesh(g, material);
      };
      const rock = side((y) => y, () => base, new THREE.MeshStandardMaterial({ color: colour('relief_rock', 'edge'), roughness: 1, side: THREE.DoubleSide }));
      const waterPaint = { color: colour('relief_water', 'accent'), transparent: true, opacity: 0.38, roughness: 0.15, depthWrite: false, side: THREE.DoubleSide };
      const waterSide = side(() => 0, (y) => Math.min(0, y), new THREE.MeshStandardMaterial(waterPaint));
      const water = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(x0 + w / 2, 0, y0 + h / 2), new THREE.MeshStandardMaterial(waterPaint));
      water.renderOrder = 1;
      waterSide.renderOrder = 1;
      const relief = new THREE.Group();
      relief.add(land, rock);
      scene.add(relief, water, waterSide);
      for (const i of list) {
        const name = nameOf(partAt(i.n, f).title, i.n, f);
        scene.add(name);
        islands.set(i.id, { ...i, name, title: partAt(i.n, f).title, value: valueOf(i.n, f.look) });
      }
      return { relief, base };
    };

    const route = (key, c) => {
      const p = wireAt(c).map(([x, y]) => new THREE.Vector3(x, 0.8, y));
      const curve = new THREE.CubicBezierCurve3(...p);
      const paint = new THREE.MeshBasicMaterial({ color: colour('muted') });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, z('deep_route'), 6), paint);
      const head = new THREE.Mesh(new THREE.ConeGeometry(z('deep_route') * 3.4, z('deep_route') * 7, 12), paint);
      const toward = curve.getTangent(1);
      head.position.copy(curve.getPoint(1)).addScaledVector(toward, -z('deep_route') * 3.5);
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toward);
      scene.add(tube, head);
      return { paint, label: null, key };
    };
    const routeWords = (r, f, lit) => {
      const at = saysAt(r.key, f);
      if (r.label) (scene.remove(r.label), r.label.material.map.dispose());
      r.label = null;
      if (!at) return;
      r.label = words(at.text, z('says_text'), { fg: lit ? page.accent : lens.muted, bg: page.panel || lens.sea, edge: lit ? page.accent : lens.line, weight: 400 });
      r.label.position.set(at.t.x, 2, at.t.y);
      scene.add(r.label);
    };

    // The eye: looking at a point on the water (cx, cz) from an angle above it (el) and from a side (az, 0 from the
    // south), as far back as it takes for what it looks at to be in sight. Straight above, the whole tile is framed
    // exactly as the flat picture frames it.
    let made = null, tilt = 0, rise = 1;
    const deg = (d) => (d * Math.PI) / 180;
    const place = (c) => {
      const el = Math.min(c.el, Math.PI / 2 - 1e-4), flat = c.far * Math.cos(el);
      camera.aspect = size.width / Math.max(1, size.height);
      camera.position.set(c.cx + flat * Math.sin(c.az), c.far * Math.sin(el), c.cz + flat * Math.cos(c.az));
      camera.up.set(-Math.sin(c.el) * Math.sin(c.az), Math.cos(c.el), -Math.sin(c.el) * Math.cos(c.az));
      camera.near = c.far / 20;
      camera.far = c.far * 4;
      camera.lookAt(c.cx, 0, c.cz);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    };
    /** Where the eye goes to see `points` (filling `room` of the picture) at that angle and side. */
    const fit = (points, cx, cz, el, az, room) => {
      const [, , w, h] = tile;
      const c = { cx, cz, el, az, far: Math.max(h, w / (size.width / Math.max(1, size.height))) / 2 / Math.tan((camera.fov * Math.PI) / 360) };
      for (let pass = 0; pass < 8; pass++) {
        place(c);
        c.far *= Math.max(...points.map((p) => Math.max(...p.clone().project(camera).toArray().slice(0, 2).map(Math.abs)))) / room;
      }
      return c;
    };
    /** The whole tile: straight above at `tilt` 0, at the style's angle at 1. */
    const whole = () => {
      const [x, y, w, h] = tile;
      const corners = [x, x + w].flatMap((px) => [y, y + h].flatMap((pz) => [made.base, peakMost * rise].map((py) => new THREE.Vector3(px, tilt ? py : 0, pz))));
      return fit(corners, x + w / 2, y + h / 2, deg(90 - (90 - num('arch_deep_angle')) * tilt), 0, 1 - (1 - num('arch_deep_near')) * tilt);
    };
    /** The islands at work, closer and lower, seen from the side they lie on. */
    const close = (ids) => {
      const [x, , w] = tile, at = ids.map((id) => islands.get(id));
      const points = at.flatMap((i) => [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [0, i.peak].map((py) => new THREE.Vector3(i.cx + sx * i.rx, py, i.cy + sz * i.ry)))));
      const cx = at.reduce((t, i) => t + i.cx, 0) / at.length, cz = at.reduce((t, i) => t + i.cy, 0) / at.length;
      const side = Math.max(-1, Math.min(1, (cx - (x + w / 2)) / (w / 2)));
      const c = fit(points, cx, cz, deg(num('arch_deep_close_angle')), deg(num('arch_deep_swing')) * side, num('arch_deep_close_room'));
      // Never so close that one island fills the picture: the map stays around it.
      return { ...c, far: Math.max(c.far, whole().far * num('arch_deep_closest')) };
    };
    // The eye glides to where it is to go, and a new goal on the way bends its path: steps that come quickly blend
    // into one move.
    let eye = null, goal = null;
    const sunOn = () => (sun.position.set(eye.cx - tile[2], eye.far, eye.cz - tile[3] / 2), sun.target.position.set(eye.cx, 0, eye.cz));
    const glide = {
      tick(dt) {
        const k = 1 - Math.exp(-dt / num('arch_deep_glide'));
        let still = true;
        for (const p of ['cx', 'cz', 'el', 'az', 'far']) {
          eye[p] += (goal[p] - eye[p]) * k;
          if (Math.abs(goal[p] - eye[p]) > (p === 'el' || p === 'az' ? 1e-3 : 0.5)) still = false;
        }
        (place(eye), sunOn());
        return still;
      },
    };
    const head = (to, at) => ((goal = to), at ? ((eye = { ...to }), place(eye), sunOn()) : (moving.add(glide), run()));
    surface.resized((now) => ((size = now), fitRenderer(), made && eye && head(goal?.whole ? { ...whole(), whole: true } : { ...goal }, true), draw()));
    const lift = z('deep_name_lift');
    const stand = () => {
      made.relief.scale.y = Math.max(0.02, rise);
      for (const it of islands.values()) it.name.position.set(it.cx, it.peak * rise + lift, it.cy);
    };

    // What moves, moved a frame at a time on the page's frames, and drawn.
    const moving = new Set();
    const draw = () => (renderer.render(scene, camera), surface.show());
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      let then = null;
      while (moving.size) {
        const now = await tools.frame();
        const dt = then === null ? 16 : Math.min(100, now - then);
        then = now;
        for (const m of moving) {
          if (m.tick) {
            if (m.tick(dt)) moving.delete(m);
            continue;
          }
          const k = Math.min(1, (now - (m.t0 ??= now)) / m.over);
          m.step(ease(k));
          if (k >= 1) moving.delete(m);
        }
        draw();
      }
      running = false;
    };
    // What moves at once is drawn with the rest of the step, once.
    const tween = (over, step) => (over > 0 ? (moving.add({ over, step }), run()) : step(1));

    return {
      /** Frame f in relief: the rest moves to how f has it over `dur`; `enter` comes from above, the land rising. */
      show(f, dur, enter) {
        made ??= ground(f);
        for (const [key, c] of f.wires) if (!routes.has(key)) routes.set(key, route(key, c));
        for (const [key, r] of routes) (routeWords(r, f, f.lit.has(key)), r.paint.color.copy(colour(f.lit.has(key) ? 'accent' : 'muted')));
        // The islands at work: those whose work moves on in this step, and those under way.
        const busy = [];
        for (const [id, n] of f.parts) {
          const it = islands.get(id);
          if (!it) continue;
          if (valueOf(n, f.look) !== it.value) ((it.value = valueOf(n, f.look)), swap(it.name, nameOf(it.title, n, f)));
          const from = uniforms.uDone.value[it.k], to = doneOf(n, f);
          if (to !== from || (to < 1 && order(f).indexOf(valueOf(n, f.look)) > 0)) busy.push(id);
          tween(enter ? 0 : dur, (k) => (uniforms.uDone.value[it.k] = from + (to - from) * k));
        }
        // Where the eye goes: to the work under way, and back to the whole map once all of it is done.
        const finished = [...f.parts].every(([, n]) => doneOf(n, f) >= 1);
        const there = () => (!enter && busy.length && !finished ? close(busy) : { ...whole(), whole: true });
        if (enter && dur) {
          // From above, flat, where the picture was; then down to the water while the land rises.
          ((tilt = 0), (rise = 0), stand(), head(whole(), true), draw());
          tween(num('arch_deep_rise'), (k) => ((tilt = k), (rise = k), stand(), head(whole(), true)));
        } else if (enter) ((tilt = 1), (rise = 1), stand(), head(whole(), true), draw());
        else {
          head(there(), !dur);
          draw();
        }
      },
    };
  }

  return {
    /** Show frame f: in relief once its look is this one, over `dur`; the flat picture again when it is not. */
    go(f, dur) {
      if (f.look !== LOOK) {
        want = null;
        if (on) ((on = false), tools.patch([{ key: 'deep', toggle: { 'sp-on': false } }, { key: 'svg', toggle: { 'sp-deep': false } }]));
        return;
      }
      want = { f, dur };
      built().then((w) => {
        if (!w || !want || want.f !== f) return;
        const enter = !on;
        on = true;
        w.show(f, dur, enter);
        // The surface comes in over the flat picture, which goes once it is covered.
        tools.patch([{ key: 'deep', toggle: { 'sp-on': true } }]);
        if (enter) setTimeout(() => on && tools.patch([{ key: 'svg', toggle: { 'sp-deep': true } }]), dur ? num('arch_story_deep_cover') : 0);
      });
    },
  };
}
