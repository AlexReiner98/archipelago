// A style's drawing code: a process map, read from the top down. Each thing in
// the project is a step, drawn one row below the lowest step it follows (what it
// depends on, or what produced it), so the start is at the top and the last
// decision at the bottom. A step with things inside it (a checklist and its
// studies) is a box holding them. Point at a step to see what it follows and
// what follows it; scroll when it is taller than the room there is.
//
// It runs in a worker with a canvas and nothing else (see the style type's code field).

const FLOW = new Set(['depends_on', 'produced']);

export default function draw({ canvas, answer, theme, size, tree, on, open, tip, cursor }) {
  const ctx = canvas.getContext('2d');
  const { me } = tree();
  const items = answer.items;
  const root = items.find((i) => i.id === answer.lens.from) ?? items.find((i) => i.inside === null);
  const byPlace = (a, b) => a.place - b.place;
  const top = items.filter((i) => i.inside === root.id).sort(byPlace);
  const kids = new Map(top.map((i) => [i.id, items.filter((k) => k.inside === i.id).sort(byPlace)]));
  const stepOf = new Map();
  for (const i of top) {
    stepOf.set(i.id, i.id);
    for (const k of kids.get(i.id)) stepOf.set(k.id, i.id);
  }

  // a comes before b when b depends on a, or a produced b; what is inside a step counts as the step.
  const flows = answer.links.filter((l) => FLOW.has(l.kind)).map((l) => (l.kind === 'produced' ? [l.from, l.to] : [l.to, l.from]));
  const before = new Map(top.map((i) => [i.id, new Set()]));
  for (const [a, b] of flows) {
    const sa = stepOf.get(a), sb = stepOf.get(b);
    if (sa && sb && sa !== sb) before.get(sb).add(sa);
  }
  const rowOf = new Map();
  const depth = (id, path = new Set()) => {
    if (rowOf.has(id)) return rowOf.get(id);
    if (path.has(id)) return 0; // a loop: stop here
    path.add(id);
    let r = 0;
    for (const a of before.get(id)) r = Math.max(r, depth(a, path) + 1);
    path.delete(id);
    rowOf.set(id, r);
    return r;
  };
  const rows = [];
  for (const i of top) (rows[depth(i.id)] ??= []).push(i);
  const filled = rows.filter(Boolean);

  const PAD = 20, GUT = 40, CH = 30, GAP = 8, BAND = 34, MAXW = 300;
  const font = (px, weight = 400) => (ctx.font = `${weight} ${px}px system-ui, -apple-system, 'Segoe UI', sans-serif`);
  const fit = (text, width) => {
    if (ctx.measureText(text).width <= width) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  const done = (i) => !i.open;
  const yours = (i) => me && i.state.waits_on.includes(me);
  const color = (i) => (done(i) ? theme.done : yours(i) ? theme.you : i.state.blocked ? theme.blocked : i.state.sessions ? theme.session : null);
  const words = (i) => [i.title, i.status, i.state.blocked && 'blocked', yours(i) ? 'waits on you' : i.state.waits_on.length ? 'waits on someone' : null].filter(Boolean).join(' · ');

  // Where everything goes, in page pixels before scrolling.
  let chips = [], boxes = [], bands = [], height = 0;
  function layout(W) {
    chips = [];
    boxes = [];
    bands = [];
    font(13);
    const x0 = PAD + GUT, room = W - x0 - PAD;
    const flow = (list, left, width, y) => {
      const lines = [[]];
      let used = 0;
      for (const i of list) {
        const w = Math.min(MAXW, width, ctx.measureText(i.title).width + 36);
        if (lines.at(-1).length && used + GAP + w > width) {
          lines.push([]);
          used = 0;
        }
        used += (lines.at(-1).length ? GAP : 0) + w;
        lines.at(-1).push({ item: i, w });
      }
      for (const line of lines) {
        const total = line.reduce((s, c) => s + c.w, 0) + GAP * (line.length - 1);
        let x = left + (width - total) / 2;
        for (const c of line) {
          chips.push({ item: c.item, x, y, w: c.w, h: CH });
          x += c.w + GAP;
        }
        y += CH + GAP;
      }
      return y - GAP;
    };
    let y = PAD;
    filled.forEach((list, n) => {
      const y0 = y;
      const singles = list.filter((i) => !kids.get(i.id).length);
      if (singles.length) y = flow(singles, x0, room, y);
      for (const g of list.filter((i) => kids.get(i.id).length)) {
        if (y > y0) y += GAP * 2;
        const by = y;
        y = flow(kids.get(g.id), x0 + 12, room - 24, y + 38) + 12;
        boxes.push({ item: g, x: x0, y: by, w: room, h: y - by });
      }
      bands.push({ n, y0, y1: y });
      y += BAND;
    });
    height = y - BAND + PAD;
  }

  let scroll = 0, hover = null;
  const clamp = () => (scroll = Math.max(0, Math.min(scroll, height - size.height)));
  const shapeOf = (id) => chips.find((c) => c.item.id === id) ?? boxes.find((b) => b.item.id === id);

  function paint() {
    const W = size.width, H = size.height;
    canvas.width = Math.round(W * size.dpr);
    canvas.height = Math.round(H * size.dpr);
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.fillStyle = theme.sea;
    ctx.fillRect(0, 0, W, H);
    layout(W);
    clamp();
    ctx.translate(0, -scroll);

    // The rail: a numbered step for each row, joined top to bottom.
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD + 12, bands[0]?.y0 ?? 0);
    ctx.lineTo(PAD + 12, bands.at(-1)?.y0 ?? 0);
    ctx.stroke();
    for (const b of bands) {
      ctx.beginPath();
      ctx.arc(PAD + 12, b.y0 + CH / 2, 11, 0, Math.PI * 2);
      ctx.fillStyle = theme.land;
      ctx.fill();
      ctx.stroke();
      font(11, 600);
      ctx.fillStyle = theme.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.n + 1), PAD + 12, b.y0 + CH / 2 + 0.5);
      if (b.n < bands.length - 1) {
        // A small arrow down to the next row.
        const cx = PAD + GUT + (W - PAD * 2 - GUT) / 2, yy = b.y1 + BAND / 2;
        ctx.fillStyle = theme.line;
        ctx.beginPath();
        ctx.moveTo(cx - 6, yy - 4);
        ctx.lineTo(cx + 6, yy - 4);
        ctx.lineTo(cx, yy + 4);
        ctx.fill();
      }
    }

    // What the pointed-at step follows and leads to.
    if (hover) {
      const near = flows.filter(([a, b]) => a === hover.id || b === hover.id);
      ctx.lineWidth = 1.5;
      for (const [a, b] of near) {
        const from = shapeOf(a), to = shapeOf(b);
        if (!from || !to) continue;
        ctx.strokeStyle = b === hover.id ? theme.muted : theme.session;
        ctx.beginPath();
        ctx.moveTo(from.x + from.w / 2, from.y + from.h);
        ctx.bezierCurveTo(from.x + from.w / 2, from.y + from.h + 40, to.x + to.w / 2, to.y - 40, to.x + to.w / 2, to.y);
        ctx.stroke();
      }
    }

    for (const b of boxes) {
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 12);
      ctx.fillStyle = theme.land;
      ctx.fill();
      ctx.strokeStyle = hover?.id === b.item.id ? theme.text : theme.line;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const inside = kids.get(b.item.id);
      font(13, 700);
      ctx.fillStyle = theme.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(fit(b.item.title, b.w - 140), b.x + 14, b.y + 20);
      font(12);
      ctx.fillStyle = theme.muted;
      ctx.textAlign = 'right';
      ctx.fillText(`${inside.filter(done).length} of ${inside.length} done`, b.x + b.w - 14, b.y + 20);
    }

    for (const c of chips) {
      const i = c.item, mark = color(i), lit = hover?.id === i.id;
      ctx.beginPath();
      ctx.roundRect(c.x, c.y, c.w, c.h, 8);
      ctx.fillStyle = kids.has(i.id) ? theme.land : theme.inner;
      ctx.fill();
      ctx.strokeStyle = lit ? theme.text : yours(i) ? theme.you : theme.line;
      ctx.lineWidth = lit ? 2 : 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.x + 14, c.y + c.h / 2, 4.5, 0, Math.PI * 2);
      if (mark) {
        ctx.fillStyle = mark;
        ctx.fill();
      } else {
        ctx.strokeStyle = theme.muted;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      font(13);
      ctx.fillStyle = done(i) ? theme.muted : theme.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(fit(i.title, c.w - 34), c.x + 26, c.y + c.h / 2 + 0.5);
    }
  }

  const at = (e) => {
    const y = e.y + scroll;
    const inside = (s) => e.x >= s.x && e.x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
    return chips.find(inside)?.item ?? boxes.find((b) => inside({ ...b, h: 40 }))?.item ?? null;
  };
  on('pointermove', (e) => {
    const i = at(e);
    cursor(i ? 'pointer' : 'default');
    tip(i ? words(i) : null, e.x, e.y);
    if (i?.id !== hover?.id) {
      hover = i;
      paint();
    }
  });
  on('pointerleave', () => {
    tip(null, 0, 0);
    if (hover) {
      hover = null;
      paint();
    }
  });
  on('pointerup', (e) => {
    const i = at(e);
    if (i) open(i.id);
  });
  on('wheel', (e) => {
    if (height <= size.height) return;
    scroll += e.deltaY;
    paint();
  });
  on('resize', paint);
  paint();
}
