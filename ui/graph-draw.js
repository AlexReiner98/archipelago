// The graph's drawing: work along a scale of tokens, or boxes joined by lines.

import { h } from './base.js';
import { BLOCKING, KINDS, groupOf, isOf, s } from './graph.js';
import { relations, tokensText, typeTitle } from './words.js';

export function timeline(nodes, edges, byId, focus, prefs) {
  const ROW = { h: 30, gap: 10, top: 28 };
  // What a thing is part of. Part of two things in sight (a feature and its project), it sits under the nearer: the one that is itself part of something.
  const parts = edges.filter((e) => isOf(['part_of'], e.type) && byId.get(e.from).work && byId.get(e.to).work);
  const inner = new Set(parts.map((e) => e.from));
  const parentOf = new Map();
  for (const e of parts) if (!parentOf.has(e.from) || (inner.has(e.to) && !inner.has(parentOf.get(e.from)))) parentOf.set(e.from, e.to);
  const waits = edges.filter((e) => isOf(BLOCKING, e.type));
  // Around one piece of work the scale is that work's own: it, and what is part of it, have a length. What it is
  // itself part of, and work that belongs elsewhere, do not: the first would only be a bar across everything.
  const within = (id) => {
    for (let at = id, far = 0; at && far < 8; at = parentOf.get(at), far++) if (at === focus) return true;
    return false;
  };
  const scaled = new Set(nodes.filter((n) => n.work && (!focus || within(n.id))).map((n) => n.id));
  // What that work waits on from outside it, or what waits on it (a decision, a person, work that belongs
  // elsewhere), takes none of the scale: it is a mark in the order, where it falls.
  const gates = new Set();
  for (let grew = Boolean(focus); grew; ) {
    grew = false;
    for (const e of waits) {
      for (const [id, other] of [[e.from, e.to], [e.to, e.from]]) {
        if (scaled.has(id) || gates.has(id) || !(scaled.has(other) || gates.has(other))) continue;
        gates.add(id);
        grew = true;
      }
    }
  }
  for (const id of gates) {
    byId.get(id).gate = true;
    parentOf.set(id, focus);
  }
  for (const id of [...parentOf.keys()]) if (!scaled.has(id) && !gates.has(id)) parentOf.delete(id);
  if (focus) parentOf.delete(focus);
  const timed = nodes.filter((n) => scaled.has(n.id));
  const kids = new Map();
  for (const [kid, parent] of parentOf) kids.set(parent, [...(kids.get(parent) ?? []), byId.get(kid)]);
  // A feature that is built is done, though it stays open until it ships.
  const done = (n) => !n.open || n.status === 'built';
  const under = (n) => n.active || (n.tokens?.used ?? 0) > 0 || ['doing', 'building', 'investigating'].includes(n.status);
  const stage = (n) => (done(n) ? 0 : under(n) ? 1 : 2);
  // How long a chain of waiting ends in a thing: nothing for what can start now, one more than the deepest thing it waits on otherwise.
  const depths = new Map();
  const depth = (id, trail = new Set()) => {
    if (depths.has(id)) return depths.get(id);
    if (trail.has(id)) return 0; // a loop of waiting: stop going round
    trail.add(id);
    const d = Math.max(0, ...waits.filter((e) => e.from === id && byId.get(e.to).open).map((e) => depth(e.to, trail) + 1));
    trail.delete(id);
    depths.set(id, d);
    return d;
  };
  const inOrder = (list) => {
    // Down the page is the order things happen in: what is done, then what is under way, then what is still to come, each in its place on the roadmap.
    // Among those with no place, what can start now comes before what waits, and what waits on more comes later.
    // Where nothing else says, the order things were written down in: it is usually the order they were thought of in.
    const sorted = [...list].sort((a, b) => stage(a) - stage(b) || (a.place ?? a.order ?? 1e9) - (b.place ?? b.order ?? 1e9) || depth(a.id) - depth(b.id) || String(a.created ?? '').localeCompare(String(b.created ?? '')) || a.title.localeCompare(b.title));
    // What waits comes after what it waits on. A loop of waiting stops going round.
    for (let pass = 0; pass < sorted.length; pass++) {
      let moved = false;
      for (const e of waits) {
        const [i, j] = [sorted.findIndex((n) => n.id === e.from), sorted.findIndex((n) => n.id === e.to)];
        if (i < 0 || j <= i) continue;
        sorted.splice(j, 0, ...sorted.splice(i, 1));
        moved = true;
      }
      if (!moved) break;
    }
    return sorted;
  };
  const known = timed.filter((n) => n.tokens?.estimated > 0 && !kids.get(n.id)?.length).map((n) => n.tokens.estimated).sort((a, b) => a - b);
  const middling = known.length ? known[Math.floor(known.length / 2)] : 50_000;
  const rows = [];
  // Every bar is exactly the stretch of the scale it takes, so no two that follow each other overlap and a
  // bar spans exactly what is part of it. A finished thing takes what it used; one under way, what it is
  // expected to or what it has used already if that is more; one to come, what it is expected to. What is
  // filled in is what has been used, and the part of that beyond the estimate is marked as over.
  const place = (n, start) => {
    if (rows.includes(n)) return start; // a loop of belonging: stop going round
    rows.push(n);
    if (n.gate) return Object.assign(n, { t0: start, len: 0, fills: [], guess: false }), start;
    let cursor = start;
    let within = 0;
    const fills = [];
    for (const kid of inOrder(kids.get(n.id) ?? [])) {
      cursor = place(kid, cursor);
      fills.push(...kid.fills);
      within += kid.tokens?.used ?? 0;
    }
    const { estimated = 0, used = 0 } = n.tokens ?? {};
    n.guess = !(estimated > 0);
    n.t0 = start;
    if (cursor > start) {
      // Over its parts it is filled where they are, and then by what was spent on it directly.
      const own = Math.max(used - within, 0);
      if (own > 0) fills.push({ t0: cursor, t1: cursor + own });
      n.len = cursor + own - start;
      if (!done(n)) n.len = Math.max(n.len, estimated);
    } else {
      const expected = estimated || (done(n) && used) || Math.max(used, middling);
      n.len = done(n) ? used || expected : Math.max(expected, used);
      const filled = done(n) ? n.len : Math.min(used, n.len);
      const expectedPart = estimated > 0 ? Math.min(estimated, filled) : filled;
      if (expectedPart > 0) fills.push({ t0: start, t1: start + expectedPart });
      if (filled > expectedPart) fills.push({ t0: start + expectedPart, t1: start + filled, over: true });
    }
    n.fills = fills;
    return start + n.len;
  };
  const roots = timed.filter((n) => !parentOf.has(n.id));
  let total = 0;
  for (const n of [...roots.filter((x) => x.id === focus), ...inOrder(roots.filter((x) => x.id !== focus))]) total = place(n, total);
  // The scale is as long as the room allows once every bar's name, written after it where it does not fit inside, is in sight too.
  const room = prefs.width ?? 1000;
  const written = (n, w) => {
    const name = Math.min((n.place ? 4 : 0) + n.title.length, 46) * 6.7;
    return 8 + (name + 20 <= w ? 0 : name + 8) + 96;
  };
  let scale = room / (total || middling);
  for (let pass = 0; pass < 4; pass++) scale = Math.min(scale, ...rows.filter((n) => n.t0 + n.len > 0).map((n) => Math.max(room - written(n, n.len * scale), 240) / (n.t0 + n.len)));
  rows.forEach((n, i) => {
    Object.assign(n, { bar: true, x: n.t0 * scale, y: ROW.top + i * (ROW.h + ROW.gap), w: n.gate ? 14 : Math.max(n.len * scale, 6), h: ROW.h, fills: n.fills.map((f) => ({ x: (f.t0 - n.t0) * scale, w: (f.t1 - f.t0) * scale, over: f.over })) });
  });
  const bottom = ROW.top + rows.length * (ROW.h + ROW.gap);
  const loose = nodes.filter((n) => !rows.includes(n)).sort((a, b) => a.title.localeCompare(b.title));
  // What has no place on the scale is set out under it, as many to a line as there is room for.
  const across = Math.max(1, Math.floor(room / 300));
  loose.forEach((n, i) => Object.assign(n, { bar: true, loose: true, x: (i % across) * 300, y: bottom + 12 + Math.floor(i / across) * (ROW.h + ROW.gap), w: 210, h: ROW.h, fills: [] }));
  // What a thing is part of is said by its bar spanning it, not by a line as well.
  // Nor is waiting that is over drawn: the order along the scale already says what came first.
  const over = (e) => isOf(BLOCKING, e.type) && !byId.get(e.to).open;
  const belongs = (e) => parts.includes(e) || (isOf(['part_of'], e.type) && rows.includes(byId.get(e.from)) && rows.includes(byId.get(e.to)));
  // Nor a wait that another already says: if it waits on B, and B on A, the line to A adds nothing but a crossing.
  const on = new Map();
  for (const e of waits) on.set(e.from, [...(on.get(e.from) ?? []), e.to]);
  const said = (e) => {
    if (!waits.includes(e)) return false;
    const seen = new Set([e.from]);
    const stack = (on.get(e.from) ?? []).filter((id) => id !== e.to);
    while (stack.length) {
      const at = stack.pop();
      if (at === e.to) return true;
      if (seen.has(at)) continue;
      seen.add(at);
      stack.push(...(on.get(at) ?? []));
    }
    return false;
  };
  return { axis: { scale, total: total || middling, top: ROW.top, bottom }, drawn: edges.filter((e) => !belongs(e) && !over(e) && !said(e)) };
}

/** The drawing itself: boxes joined by lines, each box leading to its page and free to be dragged. */
export function drawGraph({ nodes, edges, byId, focus, axis }, prefs) {
  const pad = 16;
  const cut = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
  // A title takes two lines in its box before it is cut, and is cut at a word.
  const wrap = (text, max) => {
    const lines = [''];
    for (const word of text.split(' ')) {
      if ((lines.at(-1) + ' ' + word).trim().length <= max) lines[lines.length - 1] = (lines.at(-1) + ' ' + word).trim();
      else if (lines.length < 2) lines.push(cut(word, max));
      else return [lines[0], cut(lines[1] + ' ' + word, max)];
    }
    return lines;
  };
  // On the scale of tokens a thing is a bar with its name in it, or beside it when it does not fit.
  const CHAR = 6.7;
  for (const n of nodes.filter((x) => x.bar)) {
    n.name = cut(n.place ? `${n.place}. ${n.title}` : n.title, 46);
    const { estimated = 0, used = 0 } = n.tokens ?? {};
    n.count = n.loose ? typeTitle(n.type) : n.gate ? `${typeTitle(n.type)}, ${n.status}` : used > 0 || !n.guess ? `${n.tokens?.assumed ? '~' : ''}${tokensText(used)} / ${n.guess ? '?' : tokensText(estimated)}${!n.guess && (n.tokens?.partial || n.len > estimated) ? '+' : ''}` : 'no estimate';
    n.inside = n.loose || n.name.length * CHAR + 20 <= n.w;
    n.reach = n.w + 8 + (n.inside ? 0 : n.name.length * CHAR + 8) + (n.loose ? 0 : n.count.length * 6 + 8);
  }
  const width = Math.max(...nodes.map((n) => n.x + (n.reach ?? n.w))) + pad * 2;
  const height = Math.max(...nodes.map((n) => n.y + n.h)) + pad * 2;
  const lineLayer = s('g', { transform: `translate(${pad},${pad})` });
  const boxLayer = s('g', { transform: `translate(${pad},${pad})` });
  const scaleLayer = s('g', { class: 'g-axis', transform: `translate(${pad},${pad})` });
  if (axis) {
    // A round number of tokens between the marks, about seven of them.
    const rough = axis.total / 7;
    const step = [1, 2, 5, 10].map((m) => m * 10 ** Math.floor(Math.log10(rough))).find((x) => x >= rough);
    for (let t = 0; t <= axis.total; t += step) {
      scaleLayer.append(s('line', { x1: t * axis.scale, x2: t * axis.scale, y1: axis.top - 8, y2: axis.bottom }), s('text', { x: t * axis.scale + 4, y: 11 }, document.createTextNode(t ? tokensText(t) : step * axis.scale < 64 ? '0' : '0 tokens')));
    }
  }
  const marker = (id, cls) => s('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,1 L10,5 L0,9 z', class: cls }));
  const svg = s(
    'svg',
    { ...(prefs.fit ? { width: '100%' } : { width, height }), viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': axis ? 'The work laid out by the tokens it takes' : 'Graph of the map' },
    s('defs', {}, marker('rm-arrow', 'rm-arrowhead'), marker('rm-arrow-wait', 'rm-arrowhead wait')),
    scaleLayer,
    lineLayer,
    boxLayer,
  );

  // A line leaves the side of one box that faces the other; two that overlap across are joined round their right.
  const path = (a, b) => {
    const my = (n) => n.y + n.h / 2;
    const [ar, br] = [a.x + a.w, b.x + b.w];
    if (ar > b.x + 4 && br > a.x + 4) {
      const out = Math.max(ar, br) + 46;
      return `M${ar},${my(a)} C${out},${my(a)} ${out},${my(b)} ${br + 2},${my(b)}`;
    }
    const [x1, x2] = ar <= b.x + 4 ? [ar, b.x - 2] : [a.x, br + 2];
    return `M${x1},${my(a)} C${(x1 + x2) / 2},${my(a)} ${(x1 + x2) / 2},${my(b)} ${x2},${my(b)}`;
  };
  // Along the scale a wait is a step: down from the end of what is waited on, then across into what waits. It
  // never runs through a name, which is written after its bar on the bar's own line.
  const step = (a, b) => {
    const x0 = a.x + Math.max(a.w - 14, a.w / 2);
    const down = b.y > a.y;
    const [y0, yb] = [down ? a.y + a.h : a.y, b.y + b.h / 2];
    if (b.x - 2 < x0 + 8) return `M${x0},${y0} V${down ? b.y - 2 : b.y + b.h + 2}`;
    return `M${x0},${y0} V${yb - (down ? 6 : -6)} Q${x0},${yb} ${x0 + 6},${yb} H${b.x - 2}`;
  };
  const seen = { waiting: false, met: false, lifted: false, other: false };
  const lines = edges.map((e) => {
    const blocking = isOf(BLOCKING, e.type);
    // An arrow runs from what is needed to what needs it; any other line from the thing to what it belongs to.
    const [a, b] = blocking ? [byId.get(e.to), byId.get(e.from)] : [byId.get(e.from), byId.get(e.to)];
    const structure = isOf(KINDS.structure, e.type);
    seen.waiting ||= blocking && a.open;
    seen.met ||= blocking && !a.open;
    seen.lifted ||= Boolean(e.lifted) && !axis;
    seen.other ||= !blocking && !structure;
    const phrase = relations.get(e.type)?.title ?? e.type;
    const el = s(
      'path',
      blocking ? { class: `rm-dep${a.open ? ' waiting' : ''}${e.lifted && !axis ? ' lifted' : ''}${axis ? ' step' : ''}`, 'marker-end': `url(#rm-arrow${a.open ? '-wait' : ''})` } : { class: `rm-link${structure ? '' : ' other'}${a.loose || b.loose ? ' faint' : ''}` },
      s('title', {}, document.createTextNode(`${byId.get(e.from).title} ${e.lifted ? 'waits, through their tasks, on' : phrase} ${byId.get(e.to).title}`)),
    );
    lineLayer.append(el);
    return { el, a, b, ends: [e.from, e.to], stepped: Boolean(axis) && blocking && !a.loose && !b.loose };
  });
  const route = (l) => l.el.setAttribute('d', l.stepped ? step(l.a, l.b) : path(l.a, l.b));
  lines.forEach(route);

  for (const n of nodes) {
    const { done = 0, total = 0 } = n.progress ?? {};
    const { estimated = 0, used = 0 } = n.tokens ?? {};
    const state = `${n.id === focus ? ' root' : ''}${n.open ? '' : ' closed'}${n.active ? ' active' : ''}${n.blocked ? ' blocked' : ''}`;
    const hint = s(
      'title',
      {},
      document.createTextNode(
        `${n.title}\n${typeTitle(n.type)}, ${n.status}${n.blocked ? ', blocked' : ''}${n.sessions?.length ? ', session open' : ''}${n.work ? `\n${n.guess ? 'No estimate' : `Estimated ${tokensText(estimated)} tokens`}, ${tokensText(used)} used${n.tokens?.assumed ? ' (finished work that was not measured is counted at its estimate)' : ''}${n.tokens?.partial ? '\nSome of what is part of it has no estimate yet, so it will take more' : ''}` : ''}`,
      ),
    );
    const after = n.w + 8;
    const box = n.bar
      ? s(
          'g',
          { class: `rm-node g-node bar group-${groupOf(n.kind)}${state}${n.guess ? ' guess' : ''}${n.loose ? ' loose' : ''}${n.gate ? ' gate' : ''}`, transform: `translate(${n.x},${n.y})` },
          hint,
          n.gate ? s('path', { class: 'box', d: `M0,${n.h / 2} L7,${n.h / 2 - 7} L14,${n.h / 2} L7,${n.h / 2 + 7} z` }) : s('rect', { class: 'box', width: n.w, height: n.h, rx: 3 }),
          ...n.fills.map((f) => s('rect', { class: f.over ? 'over' : 'used', x: f.x, y: 1, width: Math.min(f.w, n.w - f.x), height: n.h - 2 })),
          s('text', { x: n.inside ? 10 : after, y: 19 }, document.createTextNode(n.name)),
          !n.loose && s('text', { class: 'small', x: after + (n.inside ? 0 : n.name.length * CHAR + 8), y: 19 }, document.createTextNode(n.count)),
          n.loose && s('text', { class: 'small', x: after, y: 19 }, document.createTextNode(n.count)),
          // A wait drawn into it already says it is blocked, and by what: the mark is for when nothing in sight does.
          n.blocked && !n.gate && !lines.some((l) => l.stepped && l.b === n) && s('circle', { class: 'flag', cx: n.w - 3, cy: 3, r: 4.5 }),
        )
      : s(
          'g',
          { class: `rm-node g-node group-${groupOf(n.kind)}${state}`, transform: `translate(${n.x},${n.y})` },
          hint,
          s('rect', { class: 'box', width: n.w, height: n.h, rx: 7 }),
          s('rect', { class: 'stripe', x: 0, y: 8, width: 3, height: n.h - 16, rx: 1.5 }),
          ...wrap(n.place ? `${n.place}. ${n.title}` : n.title, 31).map((line, k) => s('text', { x: 12, y: 17 + k * 15 }, document.createTextNode(line))),
          total > 0 && s('rect', { class: 'track', x: 12, y: 42, width: 70, height: 5, rx: 2.5 }),
          total > 0 && s('rect', { class: 'fill', x: 12, y: 42, width: (70 * done) / total, height: 5, rx: 2.5 }),
          s('text', { class: 'small', x: total > 0 ? 88 : 12, y: 48 }, document.createTextNode(total > 0 ? `${done}/${total}` : typeTitle(n.type))),
          s('text', { class: 'small', x: n.w - 10, y: 48, 'text-anchor': 'end' }, document.createTextNode(n.status)),
          n.blocked && s('circle', { class: 'flag', cx: n.w - 4, cy: 4, r: 5 }),
        );
    boxLayer.append(box);
    // On the scale of tokens, where a bar is says when it happens and what it takes: it is not moved by hand, only followed.
    if (axis) {
      box.addEventListener('click', () => ((prefs.full = false), (location.hash = `#/e/${n.id}`)));
      continue;
    }
    // A press that moves is a drag, and the box stays where it is put; one that does not is a click, and leads to its page.
    box.addEventListener('pointerdown', (down) => {
      if (down.button !== 0) return;
      box.setPointerCapture(down.pointerId);
      const ratio = width / svg.getBoundingClientRect().width;
      const from = { x: n.x, y: n.y };
      let far = false;
      const move = (ev) => {
        const [dx, dy] = [(ev.clientX - down.clientX) * ratio, (ev.clientY - down.clientY) * ratio];
        far ||= Math.hypot(dx, dy) > 4;
        if (!far) return;
        n.x = Math.max(0, from.x + dx);
        n.y = Math.max(0, from.y + dy);
        box.setAttribute('transform', `translate(${n.x},${n.y})`);
        lines.filter((l) => l.ends.includes(n.id)).forEach(route);
      };
      const up = () => {
        box.removeEventListener('pointermove', move);
        box.removeEventListener('pointerup', up);
        if (far) prefs.moved.set(n.id, { x: n.x, y: n.y });
        // Following a box leaves the drawing, and so the full window.
        else ((prefs.full = false), (location.hash = `#/e/${n.id}`));
      };
      box.addEventListener('pointermove', move);
      box.addEventListener('pointerup', up);
    });
  }

  const key = (cls, text) => h('span', { class: 'key' }, h('span', { class: cls }), text);
  const legend = [
    axis && key('swatch g-est', 'Still to be used'),
    nodes.some((n) => n.fills?.some((f) => !f.over)) && key('swatch g-used', 'Used so far'),
    nodes.some((n) => n.fills?.some((f) => f.over)) && key('swatch g-over', 'Over its estimate'),
    nodes.some((n) => n.guess) && key('swatch g-guess', 'No estimate yet: its length is a guess'),
    nodes.some((n) => n.gate) && key('swatch g-gate', 'Waited on from outside this work'),
    seen.waiting && key('stroke waits', 'Waits on something unfinished'),
    seen.met && key('stroke blocking', 'Waited on something now finished'),
    seen.lifted && key('stroke lifted', 'Through their tasks'),
    seen.other && key('stroke dotted', 'Other relation'),
    nodes.some((n) => n.active) && key(axis ? 'swatch g-active' : 'swatch rm-active', 'Being worked on'),
    !axis && nodes.some((n) => !n.open) && key('swatch rm-closed', 'Finished'),
    nodes.some((n) => n.blocked) && key('swatch rm-blocked', 'Blocked'),
  ].filter(Boolean);
  return h('div', { class: 'graph-body' }, h('div', { class: 'graph-scroll' }, svg), legend.length > 0 && h('div', { class: 'legend' }, legend));
}
