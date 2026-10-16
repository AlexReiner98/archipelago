// A lens answer drawn as circles in circles, and as a style's own code.

import { h } from './base.js';
import { BLOCKING, isOf, s } from './graph.js';
import { STYLE_COLORS, lensTree, litCount, litSwitch } from './lens.js';
import { kept, link, relations, typeTitle } from './words.js';

export function drawNest(host, answer, style, keep, kept) {
  const { me, byId, root } = lensTree(answer);

  // Sizes and places. A thing with nothing sent inside it is as big as what it stands for; one with parts, as big as they are packed.
  const pack = (n, depth) => {
    n.depth = depth;
    if (!n.kids.length) return void (n.r = 6 * Math.sqrt(1 + (n.within?.not_sent ?? 0)));
    for (const kid of n.kids) pack(kid, depth + 1);
    const gap = depth < 0 ? 34 : depth === 0 ? 7 : 3.5;
    const placed = [];
    for (const kid of [...n.kids].sort((a, b) => b.r - a.r || a.place - b.place)) {
      for (let a = 0, far = 0; ; a += 0.3, far += Math.max(0.5, kid.r / 28)) {
        const [x, y] = [Math.cos(a) * far, Math.sin(a) * far];
        if (placed.some((p) => Math.hypot(p.px - x, p.py - y) < p.r + kid.r + gap)) continue;
        Object.assign(kid, { px: x, py: y });
        break;
      }
      placed.push(kid);
    }
    // Centred on what it holds, with room at the rim.
    const [cx, cy] = [(Math.min(...placed.map((p) => p.px - p.r)) + Math.max(...placed.map((p) => p.px + p.r))) / 2, (Math.min(...placed.map((p) => p.py - p.r)) + Math.max(...placed.map((p) => p.py + p.r))) / 2];
    for (const p of placed) Object.assign(p, { px: p.px - cx, py: p.py - cy });
    const reach = Math.max(...placed.map((p) => Math.hypot(p.px, p.py) + p.r));
    n.r = reach + Math.max(5, reach * 0.12);
  };
  pack(root, -1);
  const settle = (n) => n.kids.forEach((kid) => (Object.assign(kid, { x: n.x + kid.px, y: n.y + kid.py }), settle(kid)));
  settle(root);

  // What is drawn: a sea, the lines, then each thing over what it is inside.
  const lineLayer = s('g', { class: 'ln-lines' });
  const landLayer = s('g');
  const svg = s('svg', { class: 'ln-sea', role: 'img', 'aria-label': 'The map, each thing inside what it is part of' }, s('defs', {}, ...['ln-arrow', 'ln-arrow-said'].map((id) => s('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, s('path', { d: 'M0,1 L10,5 L0,9 z' })))), landLayer, lineLayer);
  const make = (n) => {
    const holds = n.all > 1;
    n.g = s('g', { class: `ln-thing${holds ? ' holds' : ' leaf'}${n.depth % 2 ? ' odd' : ''}${n.state.blocked && !holds ? ' blocked' : ''}${n.you && !holds ? ' you' : ''}${n.open ? '' : ' closed'}`, 'data-id': n.id });
    n.hint = s('title');
    n.circle = s('circle', { class: 'land' });
    n.youArc = holds && n.you > 0 && s('circle', { class: 'arc you' });
    n.blkArc = holds && n.blk > 0 && s('circle', { class: 'arc blocked' });
    n.boat = n.at > 0 && s('circle', { class: 'boat', r: 4.5 });
    n.label = s('text', { class: 'name' });
    n.g.append(n.hint, n.circle, ...[n.youArc, n.blkArc, n.boat].filter(Boolean), n.label);
    n.hint.textContent = `${n.title}\n${typeTitle(n.type)}, ${n.status}${holds ? `\n${n.work} open, ${n.blk} blocked${me ? `, ${n.you} need you` : ''}` : n.state.blocked ? ', blocked' : ''}${n.at ? '\nA session is at work here' : ''}`;
    landLayer.append(n.g);
    n.kids.forEach(make);
  };
  root.kids.forEach(make);

  const trail = h('span', { class: 'lens-trail' });
  const lit = litSwitch(me, style, keep, () => frame());
  const page = h('button', { title: 'Open its page' }, 'Open');
  host.replaceChildren(h('div', { class: 'toolbar fold-bar' }, trail, h('span', { class: 'grow' }), page, lit), svg);

  const view = { x: 0, y: 0, k: 1 };
  let [W, H] = [800, 500];
  let focus = root;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  // The whole of a thing in sight, with some sea around it.
  const fit = (n) => {
    if (n !== root) return { x: n.x, y: n.y, k: (Math.min(W, H) * 0.92) / (2 * n.r) };
    const [x0, x1, y0, y1] = [Math.min(...root.kids.map((p) => p.x - p.r)), Math.max(...root.kids.map((p) => p.x + p.r)), Math.min(...root.kids.map((p) => p.y - p.r)), Math.max(...root.kids.map((p) => p.y + p.r))];
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k: Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.9 };
  };
  const cut = (text, room) => (room < 4 ? '' : text.length > room ? text.slice(0, room - 1).trimEnd() + '…' : text);
  const lines = (text, room, most) => {
    const out = [''];
    for (const word of text.split(' ')) {
      if ((out.at(-1) + ' ' + word).trim().length <= room) out[out.length - 1] = (out.at(-1) + ' ' + word).trim();
      else if (out.length < most) out.push(cut(word, room));
      else return [...out.slice(0, -1), cut(out.at(-1) + ' ' + word, room)];
    }
    return out;
  };
  const write = (n, rows, x, y, cls) => {
    const said = `${cls}|${rows.join('|')}`;
    if (n.said !== said) {
      n.said = said;
      n.label.setAttribute('class', `name ${cls}`);
      n.label.replaceChildren(...rows.map((row, i) => s('tspan', { dy: i ? 13 : 0, class: i && cls !== 'leaf' ? 'count' : null }, document.createTextNode(row))));
    }
    for (const span of n.label.children) span.setAttribute('x', x);
    n.label.setAttribute('y', y);
  };
  const drawn = new Map();
  const few = byId.size <= 24;
  const frame = () => {
    const shut = Math.min(W, H) * 0.34;
    const place = (n, shown, seen) => {
      const [sr, sx, sy] = [n.r * view.k, (n.x - view.x) * view.k + W / 2, (n.y - view.y) * view.k + H / 2];
      // A thing opens as it grows on the screen: its own marks fade and its parts come in.
      const open = n.kids.length ? clamp((sr - shut) / (shut * 0.12)) : 0;
      Object.assign(n, { sr, sx, sy, seen, opened: open > 0.5 });
      const inSight = shown > 0.03 && sx + sr > 0 && sx - sr < W && sy + sr > 0 && sy - sr < H;
      n.g.style.display = inSight ? '' : 'none';
      if (inSight) {
        const count = litCount(n, style);
        n.g.setAttribute('opacity', shown * (count ? 1 : 0.2));
        n.g.classList.toggle('open', open > 0.5);
        for (const [key, value] of [['cx', sx], ['cy', sy], ['r', Math.max(sr, 1.5)]]) n.circle.setAttribute(key, value);
        // Closed, it shows the share of what it holds that needs you, then the share that is blocked.
        const rim = Math.max(sr - Math.max(3, Math.min(sr * 0.16, 9)), 1);
        const round = 2 * Math.PI * rim;
        let from = 0;
        for (const [arc, share] of [[n.youArc, n.you / n.all], [n.blkArc, n.blk / n.all]]) {
          if (!arc) continue;
          const len = Math.max(share * round, 3);
          for (const [key, value] of [['cx', sx], ['cy', sy], ['r', rim], ['stroke-width', Math.max(2, Math.min(sr * 0.13, 7))], ['stroke-dasharray', `${len} ${round}`], ['stroke-dashoffset', -from], ['transform', `rotate(-90 ${sx} ${sy})`], ['opacity', (1 - open) * (sr > 7 ? 1 : 0)]]) arc.setAttribute(key, value);
          from += len + 2;
        }
        if (n.boat) for (const [key, value] of [['cx', sx + sr * 0.71], ['cy', sy - sr * 0.71], ['opacity', sr > 9 ? 1 : 0]]) n.boat.setAttribute(key, value);
        // Its name: across its top when it is open, in its middle with a count when it is closed, wrapped when it holds nothing.
        const cx = Math.max(Math.min(sx, W - 70), 70);
        if (open > 0.5) write(n, [cut(n.title, Math.floor(Math.min(sr * 1.5, W - 40) / 7))], cx, Math.max(sy - sr + 17, 16), 'top');
        else if (n.all > 1 && sr >= 22 && !(few && n.title.length > Math.floor((sr * 1.8) / 6.6))) write(n, [cut(n.title, Math.floor((sr * 1.8) / 6.6)), sr >= 36 ? (style.lit === 'you' ? `${n.you} need you` : style.lit === 'blocked' ? `${n.blk} blocked` : `${n.work} open`) : ''].filter(Boolean), sx, sy + (sr >= 36 ? -2 : 4), 'mid');
        else if (n.all === 1 && sr >= 26) {
          const rows = lines(n.title, Math.floor((sr * 1.7) / 6.1), Math.max(1, Math.min(4, Math.floor((sr * 1.5) / 13))));
          write(n, rows, sx, sy + 4 - ((rows.length - 1) * 13) / 2, 'leaf');
        } else if (few && sr >= 3) {
          // A picture of a few things names each one, beside it when it is too small to hold its name.
          // As much of it as the room to the right of it holds.
          const rows = lines(n.title, Math.max(8, Math.min(26, Math.floor((W - sx - sr - 10) / 6))), 2);
          write(n, rows, sx + sr + 6, sy + 4 - ((rows.length - 1) * 13) / 2, 'beside');
        } else write(n, [], sx, sy, 'none');
      }
      for (const kid of n.kids) place(kid, shown * open, seen && open > 0.5);
    };
    for (const top of root.kids) place(top, 1, true);

    // A link runs between the nearest things in sight that stand for its ends, so a closed thing gathers the links of its parts.
    const stand = (id) => {
      let n = byId.get(id);
      while (n && !n.seen) n = n.up === root ? undefined : n.up;
      return n;
    };
    const wanted = new Map();
    for (const link of answer.links) {
      const [a, b] = [stand(link.from), stand(link.to)];
      if (!a || !b || a === b) continue;
      // A tie a session drew keeps its own words, so two drawn between the same two things are two lines.
      const key = `${link.kind} ${a.id} ${b.id}${link.says ? ` ${link.says}` : ''}`;
      const line = wanted.get(key) ?? { kind: link.kind, a, b, n: 0, says: link.says };
      line.n += link.n;
      wanted.set(key, line);
    }
    for (const [key, el] of drawn) if (!wanted.has(key)) (el.remove(), el.words?.remove(), drawn.delete(key));
    // Asked to light some things by name, a line stays lit only between two of them.
    const only = Array.isArray(style.only) ? new Set(style.only) : null;
    for (const [key, { kind, a, b, n, says }] of wanted) {
      let el = drawn.get(key);
      if (!el) {
        el = s('line', { class: `ln-line${isOf(BLOCKING, kind) ? ' waits' : ''}${says ? ' said' : ''}`, 'marker-end': says ? 'url(#ln-arrow-said)' : isOf(BLOCKING, kind) ? 'url(#ln-arrow)' : null }, s('title'));
        // What a session said ties the two is written on the line.
        if (says) el.words = s('text', { class: 'said', 'text-anchor': 'middle' }, document.createTextNode(says.length > 28 ? says.slice(0, 27) + '…' : says));
        drawn.set(key, el);
        lineLayer.append(el, ...(el.words ? [el.words] : []));
      }
      const len = Math.hypot(b.sx - a.sx, b.sy - a.sy) || 1;
      const [ux, uy] = [(b.sx - a.sx) / len, (b.sy - a.sy) / len];
      const lit = only ? (litCount(a, style) && litCount(b, style) ? 0.9 : 0.12) : style.lit === 'you' ? 0.15 : 0.75;
      const shown = len < a.sr + b.sr + 8 ? 0 : lit;
      for (const [k, v] of [['x1', a.sx + ux * (a.sr + 2)], ['y1', a.sy + uy * (a.sr + 2)], ['x2', b.sx - ux * (b.sr + 4)], ['y2', b.sy - uy * (b.sr + 4)], ['opacity', shown]]) el.setAttribute(k, v);
      if (el.words) for (const [k, v] of [['x', (a.sx + ux * a.sr + b.sx - ux * b.sr) / 2], ['y', (a.sy + uy * a.sr + b.sy - uy * b.sr) / 2 - 5], ['opacity', len > a.sr + b.sr + 60 ? shown : 0]]) el.words.setAttribute(k, v);
      el.firstChild.textContent = `${a.title} ${says ?? relations.get(kind)?.title ?? kind} ${b.title}${n > 1 ? `, ${n} times over` : ''}`;
    }

    // Where the picture is: the deepest open thing that holds the middle of it.
    let at = root;
    for (let next; (next = at.kids.find((kid) => kid.opened && Math.hypot(kid.sx - W / 2, kid.sy - H / 2) < kid.sr)); ) at = next;
    if (at !== focus || !trail.firstChild) {
      focus = at;
      const path = [];
      for (let n = at; n !== root; n = n.up) path.unshift(n);
      trail.replaceChildren(...[root, ...path].flatMap((n, i) => [i > 0 && h('span', { class: 'sep' }, '›'), h('button', { class: n === at ? 'here' : '', title: n === root ? 'The whole picture' : n.title, onclick: () => zoomTo(n) }, n === root ? 'All' : n.title)]).filter(Boolean));
      page.hidden = at === root;
      page.onclick = () => (location.hash = `#/e/${at.id}`);
    }
  };

  host.redraw = frame;
  let moving;
  // What was last gone to, until the picture is moved by hand: it is fitted again when the room changes.
  let aim = byId.get(kept.aim) ?? root;
  const zoomTo = (n, glide = true) => {
    aim = n;
    kept.aim = n.id;
    const [from, to, t0] = [{ ...view }, fit(n), performance.now()];
    cancelAnimationFrame(moving);
    if (!glide) return void (Object.assign(view, to), frame());
    const step = (now) => {
      const t = clamp((now - t0) / 600);
      const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      Object.assign(view, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k * (to.k / from.k) ** e });
      frame();
      if (t < 1 && host.isConnected) moving = requestAnimationFrame(step);
    };
    moving = requestAnimationFrame(step);
  };

  // A press that moves drags the picture; one that does not is a click: into a closed thing, to the page of one that holds nothing, out from the sea.
  svg.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    svg.setPointerCapture(down.pointerId);
    const from = { ...view };
    const target = down.target;
    let far = false;
    const move = (ev) => {
      // Only the pointer that pressed, and only while it is down.
      if (ev.pointerId !== down.pointerId || !(ev.buttons & 1)) return;
      const [dx, dy] = [ev.clientX - down.clientX, ev.clientY - down.clientY];
      far ||= Math.hypot(dx, dy) > 4;
      if (!far) return;
      cancelAnimationFrame(moving);
      aim = undefined;
      Object.assign(view, { x: from.x - dx / view.k, y: from.y - dy / view.k });
      frame();
    };
    const up = () => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      if (far) return;
      const n = byId.get(target.closest?.('[data-id]')?.dataset.id);
      if (!n) return zoomTo(focus.up ?? root);
      if (!n.kids.length) return void (location.hash = `#/e/${n.id}`);
      if (n.opened && target.closest('text')) return void (location.hash = `#/e/${n.id}`);
      zoomTo(n === focus ? (n.up ?? root) : n);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
  });
  // The wheel zooms about the pointer, no further out than the whole picture.
  svg.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      cancelAnimationFrame(moving);
      aim = undefined;
      const box = svg.getBoundingClientRect();
      const [px, py] = [ev.clientX - box.left - W / 2, ev.clientY - box.top - H / 2];
      const k = Math.max(fit(root).k * 0.7, Math.min(view.k * Math.exp(-ev.deltaY * 0.0016), 60));
      Object.assign(view, { x: view.x + px / view.k - px / k, y: view.y + py / view.k - py / k, k });
      frame();
    },
    { passive: false },
  );
  // It is drawn to the room it has, and again when that changes.
  let sized = false;
  new ResizeObserver(() => {
    const [w, hgt] = [svg.clientWidth, svg.clientHeight];
    if (!w || !hgt || (w === W && hgt === H && sized)) return;
    [W, H] = [w, hgt];
    sized = true;
    aim ? zoomTo(aim, false) : frame();
  }).observe(svg);
}
/**
 * A style that carries its own code is the drawing: the page runs it in a
 * frame that is sandboxed (an origin of its own, nothing loaded from outside,
 * nothing sent anywhere), hands it the lens answer, the style's fields and the
 * page's colours, and listens for two things: open this item, and what went
 * wrong. A new frame for each picture, so nothing of the last is left running.
 */
export function drawCode(host, answer, style, keep) {
  const { code, ...fields } = style;
  const { style: _kept, ...data } = answer;
  const error = h('div', { class: 'lens-error', hidden: true });
  const stage = h('div');
  const colours = () => Object.fromEntries(STYLE_COLORS.map((name) => [name, getComputedStyle(host).getPropertyValue(`--ln-${name}`).trim()]));
  let frame;
  const draw = () => {
    error.hidden = true;
    frame = h('iframe', { class: 'lens-frame', sandbox: 'allow-scripts', src: '/draw.html', title: 'The map, drawn by this style' });
    stage.replaceChildren(frame);
    // A frame that never says it is ready was not let in by the browser: say so, not a blank.
    const mine = frame;
    setTimeout(() => mine === frame && !mine.ready && host.isConnected && ((error.textContent = 'This style has code of its own, and the browser did not start the frame it runs in.'), (error.hidden = false)), 5000);
  };
  const hear = (ev) => {
    if (!host.isConnected) return void (frame && window.removeEventListener('message', hear));
    if (ev.source !== frame?.contentWindow) return;
    const said = ev.data ?? {};
    // The frame has no origin to name, so it is spoken to by its window alone; what goes in is only what it is to draw.
    if (said.type === 'ready') frame.ready = true;
    if (said.type === 'ready') frame.contentWindow.postMessage({ type: 'draw', code, answer: data, style: fields, theme: { ...colours(), dark: matchMedia('(prefers-color-scheme: dark)').matches } }, '*');
    // It may ask for an item's page and nothing else: an id is the only address taken from it.
    else if (said.type === 'open' && /^e_[a-z0-9]{8}$/.test(said.id)) location.hash = `#/e/${said.id}`;
    // The first thing that went wrong is the one to read: what follows is usually its echo.
    else if (said.type === 'error' && error.hidden) ((error.textContent =`This style's code stopped: ${String(said.message).slice(0, 300)}`), (error.title = error.textContent), (error.hidden = false));
  };
  window.addEventListener('message', hear);
  host.replaceChildren(h('div', { class: 'toolbar fold-bar' }, h('span', { class: 'grow' }), litSwitch(answer.viewer, style, (change) => (keep(change), Object.assign(fields, change)), draw)), error, stage);
  draw();
}
