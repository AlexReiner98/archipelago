// A style's drawing code: a process map, read from the top down, in the shapes
// flowcharts and BPMN share. Every item is a step of its own: work a box, a
// decision a diamond, an event a pill, a record a sheet with a wavy foot. One
// step leads to another when the other depends on it, and every such wire is
// drawn at right angles with as few turns as the steps' places allow, except
// one another path already implies; where one must pass over another, the
// one passing under is broken. The steps are
// laid out by Sugiyama's method (layers by longest path, a waypoint where a
// wire passes a layer, barycentre sweeps for the order, the order with the
// fewest crossings kept, and a step with room to sit lower moved down where
// that takes crossings away) so that wires do not cross. What follows an open
// decision is a scenario: dashed, with the option it follows written under
// the decision, and an option nothing follows yet ends in a dashed pill.
//
// The layout is the built-in flow shape's (ui/flow-layout.js); the seed joins the two into the one module a style keeps.
// It runs in a worker with a canvas and nothing else (see the style type's code field).

import { layout } from '../../ui/flow-layout.js';

const LEGEND = 128;

export default function draw({ canvas, answer, theme, size, tree, on, open, tip, cursor }) {
  const ctx = canvas.getContext('2d');
  const { me } = tree();
  const items = answer.items;
  const root = items.find((i) => i.id === answer.lens.from) ?? items.find((i) => i.inside === null);
  const font = (px, weight = 400) => (ctx.font = `${weight} ${px}px system-ui, -apple-system, 'Segoe UI', sans-serif`);
  const fit = (text, width) => {
    if (ctx.measureText(text).width <= width) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  const { nodes, all, chains, breaks, potential, x, y, width, height } = layout({
    items,
    links: answer.links,
    rootId: root.id,
    measure: (text, px) => (font(px), ctx.measureText(text).width),
    // The lengths it lays out by are the style's: the house style names them, and this style may change any.
    sizes: answer.style.sizes,
    numbers: answer.style.numbers,
  });

  // ---- Drawing.
  const done = (i) => !i.open;
  const yours = (i) => me && i.state.waits_on.includes(me);
  const dotColor = (i) => (done(i) ? theme.done : yours(i) ? theme.you : i.state.blocked ? theme.blocked : i.state.sessions ? theme.session : null);
  const words = (n) =>
    n.stub
      ? `${n.item.title} · a scenario`
      : [n.item.title, n.item.status, n.item.fields?.outcome && `chose: ${n.item.fields.outcome}`, n.item.state.blocked && 'blocked', yours(n.item) ? 'waits on you' : n.item.state.waits_on.length ? 'waits on someone' : null, potential.has(n.id) && 'a scenario', ...(n.notes ?? []).map((i) => `on it: ${i.title}${yours(i) ? ' (waits on you)' : ''}`)].filter(Boolean).join(' · ');
  const view = { s: 1, dx: 0, dy: 0 };
  let hover = null, drag = null;

  const outline = (n, X, Y) => {
    const { w, h } = n;
    ctx.beginPath();
    if (n.shape === 'diamond') {
      ctx.moveTo(X, Y - h / 2);
      ctx.lineTo(X + w / 2, Y);
      ctx.lineTo(X, Y + h / 2);
      ctx.lineTo(X - w / 2, Y);
      ctx.closePath();
    } else if (n.shape === 'pill' || n.shape === 'end') ctx.roundRect(X - w / 2, Y - h / 2, w, h, h / 2);
    else if (n.shape === 'sheet') {
      // A document: a sheet whose foot is a wave.
      const l = X - w / 2, r = X + w / 2, t = Y - h / 2, b = Y + h / 2 - 5;
      ctx.moveTo(l, t);
      ctx.lineTo(r, t);
      ctx.lineTo(r, b);
      ctx.bezierCurveTo(r - w / 4, b - 8, X + w / 8, b + 10, X, b + 2);
      ctx.bezierCurveTo(X - w / 8, b - 6, l + w / 4, b + 10, l, b + 2);
      ctx.closePath();
    } else ctx.roundRect(X - w / 2, Y - h / 2, w, h, Math.min(6, h / 5));
  };

  function paint() {
    const W = size.width, H = size.height;
    canvas.width = Math.round(W * size.dpr);
    canvas.height = Math.round(H * size.dpr);
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.fillStyle = theme.sea;
    ctx.fillRect(0, 0, W, H);
    ctx.translate(view.dx, view.dy);
    ctx.scale(view.s, view.s);

    // Wires, at right angles, through their waypoints; the arrowhead points down into the step.
    const lit = (c) => hover && (c.a === hover.id || c.b === hover.id);
    for (const c of [...chains].sort((p, q) => Number(lit(p)) - Number(lit(q)))) {
      const pts = c.points;
      ctx.beginPath();
      ctx.moveTo(...pts[0]);
      for (const p of pts.slice(1)) ctx.lineTo(...p);
      ctx.setLineDash(c.dashed ? [6, 5] : []);
      ctx.strokeStyle = lit(c) ? theme.text : theme.muted;
      ctx.lineWidth = lit(c) ? 2 : 1.25;
      ctx.stroke();
      ctx.setLineDash([]);
      const [ex, ey] = pts.at(-1);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - 4.5, ey - 9);
      ctx.lineTo(ex + 4.5, ey - 9);
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
    // The breaks, cut out of the drops with the colour of the sea, the track left whole across them.
    for (const [bx, by] of breaks) {
      ctx.fillStyle = theme.sea;
      ctx.fillRect(bx - 3, by - 8, 6, 16);
      ctx.beginPath();
      ctx.moveTo(bx - 6, by);
      ctx.lineTo(bx + 6, by);
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }

    for (const n of all) {
      if (n.dummy) continue;
      const X = x.get(n.id), Y = y.get(n.id), i = n.item, scenario = n.stub || potential.has(n.id);
      outline(n, X, Y);
      ctx.fillStyle = theme.land;
      ctx.fill();
      ctx.setLineDash(scenario ? [5, 4] : []);
      ctx.strokeStyle = hover?.id === n.id ? theme.text : yours(i) ? theme.you : scenario ? theme.muted : theme.line;
      ctx.lineWidth = hover?.id === n.id ? 2 : 1.25;
      ctx.stroke();
      ctx.setLineDash([]);
      const left = n.shape === 'diamond' ? X - n.w / 2 + 48 : X - n.w / 2 + (n.stub ? 15 : 27);
      if (!n.stub) {
        ctx.beginPath();
        ctx.arc(left - 12, Y, 4.5, 0, Math.PI * 2);
        const color = dotColor(i);
        if (color) ((ctx.fillStyle = color), ctx.fill());
        else ((ctx.strokeStyle = theme.muted), (ctx.lineWidth = 1.5), ctx.stroke());
      }
      font(n.stub ? 12 : 13);
      ctx.fillStyle = done(i) || n.stub ? theme.muted : theme.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(fit(i.title, n.shape === 'diamond' ? n.w - 96 : n.w - (n.stub ? 30 : 38)), left, Y - (n.shape === 'sheet' ? 2 : 0) + 0.5);
      // Work on it that is not a step: a count on its corner, lit when some of it waits on you.
      if (n.notes) {
        const bx = X + n.w / 2 - 4, by = Y - n.h / 2;
        ctx.beginPath();
        ctx.arc(bx, by, 8, 0, Math.PI * 2);
        ctx.fillStyle = n.notes.some(yours) ? theme.you : theme.inner;
        ctx.fill();
        ctx.strokeStyle = theme.line;
        ctx.lineWidth = 1;
        ctx.stroke();
        font(10.5, 700);
        ctx.fillStyle = n.notes.some(yours) ? theme.sea : theme.text;
        ctx.textAlign = 'center';
        ctx.fillText(String(n.notes.length), bx, by + 0.5);
      }
    }

    // What each option is, written once beside the decision's drop; a scenario's pill already says it.
    const labels = new Map();
    for (const c of chains) if (c.says && !nodes.get(c.b).stub) labels.set(`${c.a} ${c.says}`, c);
    font(11.5);
    for (const c of labels.values()) {
      const d = nodes.get(c.a), text = fit(c.says, 200), w = ctx.measureText(text).width + 14;
      // Beside the drop from the decision, halfway to its track.
      const lx = x.get(d.id) + w / 2 + 6, ly = (y.get(d.id) + d.h / 2 + c.points[1][1]) / 2;
      ctx.beginPath();
      ctx.roundRect(lx - w / 2, ly - 10, w, 20, 10);
      ctx.fillStyle = theme.sea;
      ctx.fill();
      ctx.fillStyle = theme.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, lx, ly + 0.5);
    }
    legend();
  }

  // ---- The legend: what the marks on this map mean, only those it uses, in the frame's corner whatever the zoom.
  const real = all.filter((n) => !n.dummy);
  const uses = (test) => real.some(test);
  const entries = [
    ...[['box', 'Work'], ['diamond', 'Decision'], ['pill', 'Event'], ['sheet', 'Record'], ['end', 'Possible end']].filter(([shape]) => uses((n) => n.shape === shape)).map(([shape, label]) => ({ shape, label })),
    ...[[theme.done, 'Done', (i) => done(i)], [theme.blocked, 'Blocked', (i) => !done(i) && !yours(i) && i.state.blocked], [theme.you, 'Waits on you', (i) => !done(i) && yours(i)], [null, 'Not started', (i) => !done(i) && !yours(i) && !i.state.blocked && !i.state.sessions]]
      .filter(([, , test]) => uses((n) => !n.stub && test(n.item)))
      .map(([color, label]) => ({ dot: color, label })),
    ...(uses((n) => n.notes) ? [{ badge: true, label: 'Work on it' }] : []),
    { wire: 'solid', label: 'Leads to' },
    ...(chains.some((c) => c.dashed) ? [{ wire: 'dashed', label: 'If chosen' }] : []),
    ...(breaks.length ? [{ wire: 'break', label: 'Passes under' }] : []),
  ];
  function legend() {
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    const row = 18, w = LEGEND, h = entries.length * row + 12, lx = 10, ly = 10;
    ctx.beginPath();
    ctx.roundRect(lx, ly, w, h, 8);
    ctx.fillStyle = theme.land;
    ctx.fill();
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    entries.forEach((e, k) => {
      const cx = lx + 20, cy = ly + 6 + row * k + row / 2;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      if (e.shape) {
        outline({ shape: e.shape, w: 20, h: e.shape === 'diamond' ? 12 : 11 }, cx, cy);
        ctx.setLineDash(e.shape === 'end' ? [3, 2] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (e.badge || 'dot' in e) {
        ctx.arc(cx, cy, e.badge ? 6 : 4, 0, Math.PI * 2);
        if (e.badge || e.dot) ((ctx.fillStyle = e.badge ? theme.inner : e.dot), ctx.fill());
        if (e.badge || !e.dot) ctx.stroke();
      } else {
        ctx.setLineDash(e.wire === 'dashed' ? [4, 3] : []);
        if (e.wire === 'break') {
          ctx.moveTo(cx - 10, cy);
          ctx.lineTo(cx + 10, cy);
          ctx.moveTo(cx, cy - 7);
          ctx.lineTo(cx, cy - 3);
          ctx.moveTo(cx, cy + 3);
          ctx.lineTo(cx, cy + 7);
        } else {
          ctx.moveTo(cx - 10, cy);
          ctx.lineTo(cx + 10, cy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      font(11.5);
      ctx.fillStyle = theme.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.label, lx + 38, cy + 0.5);
    });
  }

  // Opened with all of it in sight when it can be read so, else at a size that reads, at its start; the wheel zooms
  // about the pointer (out to all of it) and a drag moves it, like a map.
  let fitted = 1;
  const READABLE = 0.62;
  // The map is fitted into the room beside the legend.
  const left = LEGEND + 20;
  const frame = () => {
    fitted = Math.min(1, (size.width - left - 8) / width, (size.height - 8) / height);
    view.s = Math.max(fitted, Math.min(1, READABLE));
    const start = all.find((n) => !n.dummy && n.layer === 0);
    view.dx = view.s === fitted ? left + (size.width - left - width * view.s) / 2 : left + (size.width - left) / 2 - x.get(start.id) * view.s;
    view.dy = view.s === fitted ? (size.height - height * view.s) / 2 : 0;
  };
  const clamp = () => {
    // However it is moved, some of it stays in sight.
    const keep = 80;
    view.dx = Math.min(size.width - keep, Math.max(view.dx, keep - width * view.s));
    view.dy = Math.min(size.height - keep, Math.max(view.dy, keep - height * view.s));
  };
  const hitAt = (e) => {
    const px = (e.x - view.dx) / view.s, py = (e.y - view.dy) / view.s;
    return all.find((n) => !n.dummy && Math.abs(px - x.get(n.id)) <= n.w / 2 && Math.abs(py - y.get(n.id)) <= n.h / 2) ?? null;
  };
  on('pointerdown', (e) => (drag = { x: e.x, y: e.y, dx: view.dx, dy: view.dy, moved: false }));
  on('pointermove', (e) => {
    if (drag && e.buttons) {
      if (Math.abs(e.x - drag.x) + Math.abs(e.y - drag.y) > 4) drag.moved = true;
      view.dx = drag.dx + e.x - drag.x;
      view.dy = drag.dy + e.y - drag.y;
      clamp();
      return paint();
    }
    const n = hitAt(e);
    cursor(n && !n.stub ? 'pointer' : 'default');
    tip(n ? words(n) : null, e.x, e.y);
    if (n?.id !== hover?.id) ((hover = n), paint());
  });
  on('pointerup', (e) => {
    const n = !drag?.moved && hitAt(e);
    drag = null;
    if (n && !n.stub) open(n.item.id);
  });
  on('pointerleave', () => {
    drag = null;
    tip(null, 0, 0);
    if (hover) ((hover = null), paint());
  });
  on('wheel', (e) => {
    const s = Math.min(2, Math.max(fitted * 0.9, view.s * Math.exp(-e.deltaY * 0.0015)));
    view.dx = e.x - ((e.x - view.dx) * s) / view.s;
    view.dy = e.y - ((e.y - view.dy) * s) / view.s;
    view.s = s;
    clamp();
    paint();
  });
  on('resize', () => (frame(), clamp(), paint()));
  frame();
  paint();
}
