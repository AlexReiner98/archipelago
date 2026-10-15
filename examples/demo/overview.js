// A style's drawing code: the overview the demo opens on, and the README's picture.
// Who works on the map on the left, the project with its features in the order
// they were built in the middle, and its next release on the right with what it
// still waits for. Everything is read from the lens answer; only the words under
// each kind of worker are this drawing's own.
//
// It runs in a worker with a canvas and nothing else (see the style type's code field).

const UNDER = { person: 'web page', agent: 'over MCP', 'software.repo': 'every push, on GitHub' };
const WORKERS = ['person', 'agent', 'software.repo'];
const READY = new Set(['built', 'shipped', 'done', 'decided', 'resolved']);

export default function draw({ canvas, answer, theme, size, tree, on, open, tip, cursor }) {
  const ctx = canvas.getContext('2d');
  const { byId, me } = tree();
  const items = answer.items;
  const root = items.find((i) => i.inside === null && i.id === answer.lens.from) ?? items.find((i) => i.inside === null);
  const inProject = (i) => i.inside === root.id;
  const ordered = (list) => list.sort((a, b) => a.place - b.place);

  const features = ordered(items.filter((i) => inProject(i) && i.root === 'software.feature'));
  const questions = ordered(items.filter((i) => inProject(i) && i.root === 'decision' && i.open));
  const release = items.find((i) => inProject(i) && i.type === 'software.release' && i.open);
  const near = new Set(answer.links.flatMap((l) => (l.from === root.id ? [l.to] : l.to === root.id ? [l.from] : [])));
  for (const l of answer.links) if (l.kind === 'waits_on' && byId.get(l.from)?.inside === root.id) near.add(l.to);
  const workers = items.filter((i) => WORKERS.includes(i.root) && (near.has(i.id) || i.id === me)).sort((a, b) => WORKERS.indexOf(a.root) - WORKERS.indexOf(b.root));
  const waitsFor = release ? answer.links.filter((l) => l.kind === 'depends_on' && l.from === release.id).map((l) => byId.get(l.to)).filter(Boolean) : [];
  const ready = waitsFor.filter((i) => !i.open || READY.has(i.status));
  const still = waitsFor.filter((i) => !ready.includes(i));
  const yours = (i) => me && i.state.waits_on.includes(me);

  let hits = [];
  const font = (px, weight = 400) => (ctx.font = `${weight} ${px}px system-ui, -apple-system, 'Segoe UI', sans-serif`);
  const fit = (text, width) => {
    if (ctx.measureText(text).width <= width) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  const box = (x, y, w, h, r, fill, stroke, dash) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.setLineDash(dash ?? []);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const arrow = (x1, y1, x2, y2, color, dash) => {
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dash ?? []);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - 7, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 8, y2 - 4.5);
    ctx.lineTo(x2 - 8, y2 + 4.5);
    ctx.fill();
  };
  const text = (s, x, y, px, color, weight, align = 'left', width = 1e9) => {
    font(px, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(fit(s, width), x, y);
  };
  const dot = (x, y, color, hollow) => {
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    if (hollow) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
  };
  const mark = (i) => (READY.has(i.status) || !i.open ? [theme.done, false] : i.status === 'building' || i.status === 'doing' ? [theme.session, false] : yours(i) ? [theme.you, false] : [theme.muted, true]);

  function paint() {
    const W = size.width;
    const H = size.height;
    canvas.width = Math.round(W * size.dpr);
    canvas.height = Math.round(H * size.dpr);
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.fillStyle = theme.sea;
    ctx.fillRect(0, 0, W, H);
    hits = [];

    // Laid out for 1000 by 400 and scaled to the room there is.
    const s = Math.min(W / 1000, H / 400);
    ctx.translate((W - 1000 * s) / 2, (H - 400 * s) / 2);
    ctx.scale(s, s);
    const hit = (item, x, y, w, h) => hits.push({ item, x: x * s + (W - 1000 * s) / 2, y: y * s + (H - 400 * s) / 2, w: w * s, h: h * s });

    // Who works on it.
    const wy = (n) => 200 + (n - (workers.length - 1) / 2) * 92;
    workers.forEach((w, n) => {
      const y = wy(n);
      box(24, y - 30, 172, 60, 10, theme.land, theme.line);
      text(w.id === me ? 'You' : w.title, 110, y - 9, 15, theme.text, 600, 'center', 156);
      text(UNDER[w.root] ?? '', 110, y + 12, 12, theme.muted, 400, 'center', 156);
      arrow(196, y, 276, y, theme.muted);
      hit(w, 24, y - 30, 172, 60);
    });

    // The project: its features in order, then what is still to decide.
    const px = 280, pw = 400;
    const ph = 76 + features.length * 28 + (questions.length ? 28 + questions.length * 28 : 0);
    const py = 200 - ph / 2;
    box(px, py, pw, ph, 12, theme.land, theme.line);
    text(root.title, px + 20, py + 26, 16, theme.text, 700, 'left', pw - 40);
    hit(root, px, py, pw, 50);
    let y = py + 62;
    for (const f of features) {
      const [color, hollow] = mark(f);
      dot(px + 26, y, color, hollow);
      text(f.title, px + 42, y, 13, theme.text, 400, 'left', pw - 130);
      text(f.status, px + pw - 20, y, 11.5, theme.muted, 400, 'right');
      hit(f, px + 12, y - 12, pw - 24, 24);
      y += 28;
    }
    if (questions.length) {
      y += 6;
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 20, y);
      ctx.lineTo(px + pw - 20, y);
      ctx.stroke();
      y += 22;
      for (const q of questions) {
        text('?', px + 26, y, 13, yours(q) ? theme.you : theme.muted, 700, 'center');
        text(q.title, px + 42, y, 13, theme.text, 400, 'left', pw - 130);
        if (yours(q)) text('you', px + pw - 20, y, 11.5, theme.you, 600, 'right');
        hit(q, px + 12, y - 12, pw - 24, 24);
        y += 28;
      }
    }

    // Its next release, and what it still waits for.
    if (release) {
      const rx = 740, rw = 240;
      arrow(px + pw, 200, rx, 200, theme.muted, [5, 4]);
      const shown = still.slice(0, 4);
      const rh = 112 + shown.reduce((sum, i) => sum + (yours(i) ? 44 : 28), 0);
      const ry0 = 200 - rh / 2;
      box(rx, ry0, rw, rh, 12, theme.land, theme.blocked);
      text(release.title, rx + 16, ry0 + 26, 14, theme.text, 700, 'left', rw - 32);
      hit(release, rx, ry0, rw, 50);
      // How much of it is ready, as a bar.
      const bw = rw - 32, done = waitsFor.length ? ready.length / waitsFor.length : 0;
      box(rx + 16, ry0 + 48, bw, 8, 4, theme.inner, theme.inner);
      if (done) box(rx + 16, ry0 + 48, Math.max(8, bw * done), 8, 4, theme.done, theme.done);
      text(`${ready.length} of ${waitsFor.length} ready`, rx + 16, ry0 + 72, 12, theme.muted, 400);
      let ry = ry0 + 102;
      for (const i of shown) {
        const [color, hollow] = mark(i);
        dot(rx + 22, ry, color, hollow);
        text(i.title, rx + 34, ry, 12.5, theme.text, 400, 'left', rw - 50);
        if (yours(i)) text('waits on you', rx + 34, ry + 17, 11, theme.you, 600);
        hit(i, rx + 12, ry - 12, rw - 24, yours(i) ? 40 : 24);
        ry += yours(i) ? 44 : 28;
      }
    }
  }

  const at = (e) => hits.find((h) => e.x >= h.x && e.x <= h.x + h.w && e.y >= h.y && e.y <= h.y + h.h);
  on('pointermove', (e) => {
    const h = at(e);
    cursor(h ? 'pointer' : 'default');
    tip(h ? h.item.title : null, e.x, e.y);
  });
  on('pointerleave', () => tip(null, 0, 0));
  on('pointerup', (e) => {
    const h = at(e);
    if (h) open(h.item.id);
  });
  on('resize', paint);
  paint();
}
