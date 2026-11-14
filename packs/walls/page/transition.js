// A scene mounted again moves into its place instead of jumping: the page matches the marks it had with the marks it
// has now by their key and plays three stages, one after the other (Heer and Robertson, 2007; e_kedkk4xn): what leaves
// fades out, what stays moves from where it was, what arrives fades in, its wires drawn in. The marks are mounted
// once, as they are now, and each is moved from where it was by a transform (FLIP, e_amy3cty9): only transform and
// opacity are animated, by element.animate, so the compositor plays them and the page lays nothing out per frame.
// A wire cannot be moved by a transform: one that changed is drawn in again with what arrives (its stroke-dashoffset).
//
// The drawing knows nothing of it: it answers with keyed marks as it always has. Every timing and count is a number
// on the style (core's house style names them, `motion_*`). Past a few movers it cuts, as it does on less motion
// asked for, on a picture of too many marks, and on one that shares no mark with what was there.
//
// A mark may say it is a pulse (its `pulse`, words the page keeps on it, packs/walls/page/marks.js): unseen, it is never faded or
// moved, and when its words change while its key stays, a dash of its own stroke runs along its line, start to end,
// after what moves has moved (a finding's move carried to its readers, task e_fqhbp4yq). It runs even where the rest
// is cut for too much, never where less motion is asked for.

/** The keyed marks a host last mounted, by host: what the next scene there is matched against. */
const lastKeys = new WeakMap();
/** What is playing on a host now: its animations and the marks kept on the page to fade, ended by the next scene. */
const playing = new WeakMap();
const SVG = 'http://www.w3.org/2000/svg';

/**
 * What a change plays, from the marks as they were (`before`) and as they are (`after`), each a Map of key to
 * { box: [x, y, width, height] on the screen, wire (a stroke with no fill), path (a wire's d), holds (it holds other
 * keyed marks), within (the key of the nearest keyed mark it is in, or null) }. `numbers` are the style's. The answer
 * says why it cut (`cut`), or what leaves, moves (with its move on the screen), arrives and is drawn in, and when
 * each stage starts and how long it lasts. Pure: no page, so it is tested without one.
 */
export function stagesOf(before, after, numbers, reduced = false, framed = true) {
  const n = (name) => {
    const v = numbers?.[name];
    if (typeof v !== 'number') throw new Error(`The style names no number "${name}": the house style (core.house, packs/canvas/pack.json) names every one the page moves by`);
    return v;
  };
  const none = (cut, pulse = []) => ({ cut, frame: null, leave: [], move: [], arrive: [], draw: [], pulse, times: pulse.length ? { pulse: [0, n('motion_pulse')] } : null });
  if (reduced) return none('reduced');
  if (!before.size || !after.size) return none('new');
  // A pulse whose words changed runs; one that stays the same, comes or goes is not seen.
  const isPulse = (row) => typeof row?.pulse === 'string';
  const pulse = [...after].filter(([key, now]) => isPulse(now) && isPulse(before.get(key)) && before.get(key).pulse !== now.pulse).map(([key]) => key);
  before = new Map([...before].filter(([, row]) => !isPulse(row)));
  after = new Map([...after].filter(([, row]) => !isPulse(row)));
  if (before.size + after.size > n('motion_marks_most')) return none('marks', pulse);
  const within = n('motion_still_within');
  const near = (a, b) => Math.abs(a - b) <= within;
  const shared = [...after.keys()].filter((k) => before.has(k));
  if (!shared.length) return none('new', pulse);
  const leave = [], move = [], arrive = [], draw = [];
  // How far each mark that stays, of the same size, went on the screen. What most of them went by together is the
  // picture's frame moving (it was fitted or panned again around a picture of another size): the frame moves back
  // as one, and a mark moves only by what it went on its own.
  const went = new Map();
  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was || now.holds || now.wire) continue;
    const [x0, y0, w0, h0] = was.box, [x1, y1, w1, h1] = now.box;
    // A mark of another size is another shape: it is put there as it is.
    if (near(w0, w1) && near(h0, h1)) went.set(key, [x0 - x1, y0 - y1]);
  }
  // Each way on its own: a picture grown taller moves down as one while its steps move across.
  const [fx, fy] = framed ? [mostOf([...went.values()].map((w) => w[0])), mostOf([...went.values()].map((w) => w[1]))] : [0, 0];
  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was) {
      // In a mark that arrives too, it arrives with it.
      if (now.within !== null && now.within !== undefined && !before.has(now.within)) continue;
      (now.wire ? draw : arrive).push(key);
      continue;
    }
    // What holds other marks is a frame for them: they move, it does not.
    if (now.holds) continue;
    const [x0, y0, w0, h0] = was.box, [x1, y1, w1, h1] = now.box;
    if (now.wire) {
      if (!(near(x0 - fx, x1) && near(y0 - fy, y1) && near(w0, w1) && near(h0, h1)) || was.path !== now.path) draw.push(key);
      continue;
    }
    const by = went.get(key);
    if (by && !(near(by[0], fx) && near(by[1], fy))) move.push({ key, dx: by[0] - fx, dy: by[1] - fy });
  }
  for (const [key, was] of before) {
    if (after.has(key)) continue;
    // In a mark that leaves too, it leaves with it.
    if (was.within !== null && was.within !== undefined && !after.has(was.within)) continue;
    leave.push(key);
  }
  // Cut, it still says what would have moved.
  if (move.length > n('motion_movers_most')) return { ...none('many', pulse), move };
  const shifted = !(near(fx, 0) && near(fy, 0)) ? { dx: fx, dy: fy } : null;
  if (!leave.length && !move.length && !arrive.length && !draw.length && !shifted) return none('still', pulse);
  // Each stage starts when the one before it has ended; a stage with nothing in it takes no time.
  const out = leave.length ? n('motion_leave') : 0;
  const moving = move.length || shifted ? n('motion_move') : 0;
  const times = { leave: [0, out], move: [out, moving], arrive: [out + moving, n('motion_arrive')], pulse: [out + moving, n('motion_pulse')] };
  return { cut: null, frame: shifted, leave, move, arrive, draw, pulse, times };
}

/** How far most of these went together, to the nearest pixel; none where no two went alike. */
function mostOf(moves) {
  const count = new Map();
  for (const d of moves) {
    const at = Math.round(d), c = count.get(at) ?? { n: 0, sum: 0 };
    count.set(at, { n: c.n + 1, sum: c.sum + d });
  }
  let best = null;
  for (const c of count.values()) if (c.n > 1 && (!best || c.n > best.n)) best = c;
  return best ? best.sum / best.n : 0;
}

/** Less motion asked for, by the person's system or by the style. */
const lessMotion = (style) => Boolean(style?.reduced) || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** A wire, or a shape drawn as one (its head): a line whose points are its shape, matched by them, never moved. */
const isWire = (el) => el instanceof SVGGeometryElement && el.tagName !== 'rect' && el.tagName !== 'circle' && el.tagName !== 'ellipse';

/** The keyed marks connected in host, measured: key to { el, box, wire, path, holds, within }, and the elements. */
function measured(host, keys) {
  const els = new Map();
  for (const [key, el] of keys) if (el?.isConnected && host.contains(el) && el !== host) els.set(el, key);
  const rows = new Map();
  for (const [el, key] of els) {
    let up = el.parentElement;
    while (up && up !== host && !els.has(up)) up = up.parentElement;
    const within = up && up !== host ? els.get(up) : null;
    const r = el.getBoundingClientRect(), wire = isWire(el);
    rows.set(key, { el, box: [r.x, r.y, r.width, r.height], wire, path: wire ? el.getAttribute('d') ?? el.getAttribute('points') : null, holds: false, within, pulse: el.dataset?.pulse ?? null });
  }
  for (const row of rows.values()) if (row.within !== null && rows.has(row.within)) rows.get(row.within).holds = true;
  return rows;
}

/** An SVG mark's own transform, as CSS: the end of its move, and what its move is put before. */
const ownTransform = (el) => {
  const m = el instanceof SVGGraphicsElement ? el.transform?.baseVal?.consolidate()?.matrix : null;
  return m ? `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})` : '';
};

/** A move on the screen, in the units its mark is drawn in (its parent's, for an SVG mark). */
function inUnits(el, dx, dy) {
  const ctm = el instanceof SVGElement && el.parentNode instanceof SVGGraphicsElement ? el.parentNode.getScreenCTM?.() : null;
  if (!ctm) return [dx, dy];
  const inv = ctm.inverse();
  const a = new DOMPoint(0, 0).matrixTransform(inv), b = new DOMPoint(dx, dy).matrixTransform(inv);
  return [b.x - a.x, b.y - a.y];
}

/**
 * The hook where a scene is mounted (packs/walls/page/layout.js): called before the marks are replaced, with the Map that collects
 * the new scene's keyed marks. It measures the marks there were, and once the new ones are mounted, and the view put
 * back where the reader left it (ui/canvas.js, on the mutation), it plays what changed before the frame is painted.
 */
export function transition(host, keys, style) {
  const was = playing.get(host);
  if (was) (playing.delete(host), was.end());
  const old = lastKeys.get(host);
  lastKeys.set(host, keys);
  // The first scene on a host, and less motion asked for, are drawn as they are: nothing is measured.
  if (!old || typeof Element.prototype.animate !== 'function') return;
  if (lessMotion(style)) return void (host.dataset.transition = 'reduced');
  const before = measured(host, new Map(old));
  if (!before.size) return;
  // The marks there were stay measured where they were; those that leave are kept with their place to fade there.
  const places = new Map([...before].map(([key, row]) => [key, row.el instanceof SVGElement && row.el.parentNode?.getScreenCTM ? row.el.parentNode.getScreenCTM() : null]));
  requestAnimationFrame(() => {
    if (!host.isConnected || lastKeys.get(host) !== keys) return;
    const after = measured(host, keys);
    const root = host.querySelector('svg');
    const plan = stagesOf(before, after, style?.numbers, false, Boolean(root) && getComputedStyle(root).transform === 'none');
    host.dataset.transition = plan.cut ?? 'played';
    // What it found, for whoever looks at the page (a test, the console).
    host.transitionPlan = plan;
    if (plan.cut) return void (plan.pulse.length && playing.set(host, ended(pulses(plan, after))));
    playing.set(host, play(host, plan, before, after, places));
  });
}

/** Play a plan: each animation made at once, waiting its stage's delay, so the frame painted next is the first of it. */
function play(host, plan, before, after, places) {
  const running = [], kept = [];
  const ease = 'ease-in-out';
  const [outAt, outFor] = plan.times.leave, [moveAt, moveFor] = plan.times.move, [inAt, inFor] = plan.times.arrive;
  // What leaves: put back into the new picture where it was, under nothing the reader can touch, and faded out.
  const root = host.querySelector('svg');
  const [fx, fy] = plan.frame ? [plan.frame.dx, plan.frame.dy] : [0, 0];
  const sea = root && document.createElementNS(SVG, 'g');
  if (sea) {
    sea.setAttribute('aria-hidden', 'true');
    sea.style.pointerEvents = 'none';
    const rootCtm = root.getScreenCTM?.();
    for (const key of plan.leave) {
      const { el } = before.get(key), at = places.get(key);
      if (!(el instanceof SVGElement) || !at || !rootCtm) continue;
      // Where it stood, under the frame as it starts (moved back by the frame's own move).
      const m = DOMMatrix.fromMatrix(rootCtm).inverse().multiply(new DOMMatrix().translate(-fx, -fy)).multiply(DOMMatrix.fromMatrix(at));
      const holder = document.createElementNS(SVG, 'g');
      holder.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
      holder.append(el);
      sea.append(holder);
      running.push(holder.animate([{ opacity: 1 }, { opacity: 0 }], { duration: outFor, delay: outAt, easing: ease, fill: 'forwards' }));
    }
    if (sea.childNodes.length) (root.append(sea), kept.push(sea));
  }
  // The frame, moved back as one from where it stood, and on with what moves.
  if (plan.frame && root) running.push(root.animate([{ transform: `translate(${fx}px, ${fy}px)` }, { transform: 'none' }], { duration: moveFor, delay: moveAt, easing: ease, fill: 'backwards' }));
  // What stays: drawn where it is now, and moved there from where it was.
  for (const { key, dx, dy } of plan.move) {
    const { el } = after.get(key);
    const [ux, uy] = inUnits(el, dx, dy), own = ownTransform(el);
    const from = `translate(${ux}px, ${uy}px)${own ? ` ${own}` : ''}`, to = own || 'none';
    running.push(el.animate([{ transform: from }, { transform: to }], { duration: moveFor, delay: moveAt, easing: ease, fill: 'backwards' }));
  }
  // What arrives: unseen until its stage, then faded in; a wire is drawn in along its length as it fades.
  for (const key of plan.arrive) running.push(after.get(key).el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: inFor, delay: inAt, easing: ease, fill: 'backwards' }));
  for (const key of plan.draw) {
    const { el } = after.get(key);
    // A line is drawn in along its length; one dashed, or filled (a head), fades in.
    const css = getComputedStyle(el);
    const length = css.strokeDasharray === 'none' && css.fill === 'none' && typeof el.getTotalLength === 'function' ? el.getTotalLength() : 0;
    const frames = length > 0
      ? [{ opacity: 0, strokeDasharray: `${length} ${length}`, strokeDashoffset: length }, { opacity: 1, strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 }]
      : [{ opacity: 0 }, { opacity: 1 }];
    running.push(el.animate(frames, { duration: inFor, delay: inAt, easing: ease, fill: 'backwards' }));
  }
  running.push(...pulses(plan, after));
  return ended(running, kept);
}

/** Each pulse of a plan run along its line: a dash of its own stroke's dash (the whole line, where it has none). */
function pulses(plan, after) {
  if (!plan.pulse.length) return [];
  const [at, runs] = plan.times.pulse;
  return plan.pulse.map((key) => {
    const { el } = after.get(key);
    const length = typeof el.getTotalLength === 'function' ? el.getTotalLength() : 0;
    const dash = Number.parseFloat(getComputedStyle(el).strokeDasharray) || length;
    const along = `${dash} ${length + dash}`;
    return el.animate([{ opacity: 1, strokeDasharray: along, strokeDashoffset: dash }, { opacity: 1, strokeDasharray: along, strokeDashoffset: -length }], { duration: runs, delay: at, easing: 'ease-in-out' });
  });
}

/** What plays, ended by the next scene: every animation cancelled, what was kept to fade taken off the page. */
function ended(running, kept = []) {
  const end = () => {
    for (const a of running) a.cancel();
    for (const k of kept) k.remove();
  };
  // Once it has all played, what was kept to fade is taken off the page.
  Promise.all(running.map((a) => a.finished)).then(() => kept.forEach((k) => k.remove()), () => {});
  return { end };
}
