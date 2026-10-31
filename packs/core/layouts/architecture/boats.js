// Agents as boats on the relief map (deep.js). Whoever the steps name as the owner of work sails to the island that
// holds the work it has under way, moors off its shore beside the others there, and sails back to the harbour when it
// has none. A course bends round the islands between. The geometry (berths, courses) is pure; the boats are drawn
// with three.js, handed in. Every length and time is the style's (arch_deep_boat, arch_deep_berth, arch_deep_sail).

/** Where on a course a boat is, t from 0 to 1: a curve through three points (start, bend, end). */
export const along3 = (p, t) => [0, 1].map((i) => (1 - t) ** 2 * p[0][i] + 2 * (1 - t) * t * p[1][i] + t ** 2 * p[2][i]);
/** Whether a point is on any island's land, its outline grown by `more`. */
const onLand = (isles, [x, y], more) => isles.some((i) => ((x - i.cx) / (i.rx * more)) ** 2 + ((y - i.cy) / (i.ry * more)) ** 2 < 1);

/** Where boat `slot` of `count` moors off island i: `gap` from its shore, on the side that faces `toward`, side by side. */
export function berth(i, slot, count, toward, gap) {
  const a = Math.atan2(toward[1] - i.cy, toward[0] - i.cx) + (slot - (count - 1) / 2) * 0.6;
  const ux = Math.cos(a), uy = Math.sin(a), r = 1 / Math.hypot(ux / i.rx, uy / i.ry);
  return [i.cx + ux * (r + gap), i.cy + uy * (r + gap)];
}

/** A course from a to b that keeps off the land: the straightest of a few bends that does, else the one that touches least. */
export function course(a, b, isles) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, [nx, ny] = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len], [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let best = null, least = Infinity;
  for (const bend of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1]) {
    const p = [a, [mx + nx * bend * len, my + ny * bend * len], b];
    let hits = 0;
    for (let k = 1; k < 24; k++) if (onLand(isles, along3(p, k / 24), 1.08)) hits++;
    if (!hits) return p;
    if (hits < least) ((least = hits), (best = p));
  }
  return best;
}

/**
 * The boats: `sail(list, over)` sends each of `list` ({ id, title, at: an island's id or null }) where it is to be, over
 * `over` milliseconds. `isles` are the islands by id ({ cx, cy, rx, ry }), `harbour` where boats with nothing to do lie.
 */
export function fleet({ THREE, scene, words, hue, z, tween, isles, harbour }) {
  const boats = new Map(), size = z('deep_boat'), gap = z('deep_berth');
  const make = (b, k) => {
    const s = size, group = new THREE.Group();
    const hull = new THREE.Shape([[-1, -0.35], [0.6, -0.35], [1, 0], [0.6, 0.35], [-1, 0.35]].map(([x, y]) => new THREE.Vector2(x * s, y * s)));
    const paint = new THREE.MeshStandardMaterial({ color: hue(k), roughness: 0.55 });
    group.add(new THREE.Mesh(new THREE.ExtrudeGeometry(hull, { depth: s * 0.3, bevelEnabled: false }).rotateX(-Math.PI / 2), paint));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.04, s * 0.04, s * 1.3, 6), new THREE.MeshStandardMaterial({ color: hue(k), roughness: 0.6 }));
    mast.position.set(s * 0.1, s * 0.95, 0);
    const sail = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, s * 1.15), new THREE.Vector2(-s * 0.85, s * 0.05)])), new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 1, 1), roughness: 0.8, side: THREE.DoubleSide }));
    sail.position.set(s * 0.08, s * 0.38, 0);
    const label = words(b.title, z('says_text'), { dot: `#${hue(k).getHexString()}` });
    label.position.set(0, s * 2.3, 0);
    group.add(mast, sail, label);
    scene.add(group);
    return { group, pos: null, goal: null, run: 0 };
  };
  const put = (boat, [x, y], heading) => {
    boat.pos = [x, y];
    boat.group.position.set(x, 0.3, y);
    if (heading !== undefined) boat.group.rotation.y = -heading;
  };
  // At the harbour, side by side, each with room for its name.
  const home = (k, n) => [harbour[0] + (k - (n - 1) / 2) * size * 9, harbour[1]];
  return {
    sail(list, over) {
      const count = new Map(), slot = new Map();
      for (const b of list) if (b.at) (slot.set(b.id, count.get(b.at) ?? 0), count.set(b.at, (count.get(b.at) ?? 0) + 1));
      list.forEach((b, k) => {
        if (!boats.has(b.id)) (boats.set(b.id, make(b, k)), put(boats.get(b.id), home(k, list.length), 0));
        const boat = boats.get(b.id), i = b.at && isles.get(b.at);
        const goal = i ? berth(i, slot.get(b.id), count.get(b.at), harbour, gap) : home(k, list.length);
        if (boat.goal && Math.hypot(goal[0] - boat.goal[0], goal[1] - boat.goal[1]) < 0.5) return;
        boat.goal = goal;
        const run = ++boat.run, p = course(boat.pos, goal, [...isles.values()]);
        // Under way from wherever it is now: a later order takes over from this one.
        tween(over, (t) => {
          if (boat.run !== run) return;
          const q = along3(p, t), ahead = along3(p, Math.min(1, t + 0.02));
          const moving = Math.hypot(ahead[0] - q[0], ahead[1] - q[1]) > 1e-3;
          put(boat, q, moving ? Math.atan2(ahead[1] - q[1], ahead[0] - q[0]) : undefined);
        });
      });
    },
  };
}
