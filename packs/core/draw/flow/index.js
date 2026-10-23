// A lens answer drawn as a process map, read from the top down: every item a step (work a box, a question a diamond,
// an occurrence a pill, a record a sheet with a wavy foot), wires at right angles from what is depended on to what
// depends on it, broken where one passes under another, and what follows an open question dashed, as a scenario.
// Many plain things before one step (a release's prerequisites) are checklists, one for each type, a row each.
// The layout is ./layout.js; this answers with the marks to draw (SVG and HTML as data), which the page checks and
// mounts, so every name is in the page and every step a link. Its look is ./look.js, in the lens's colours. A lens
// with steps tells the process as it happens (./story.js), the conversation beside it.

import { layout } from './layout.js';
import { css } from './look.js';
import { addClass, m, titled } from './marks.js';
import { play } from './play.js';
import { css as storyCss, everyNamed, reveal, statesOf } from './story.js';

/** A lens answer as a tree, each thing with what it says of itself and of all that is inside it. */
function lensTree(answer) {
  const byId = new Map(answer.items.map((item) => [item.id, { ...item, kids: [] }]));
  const root = { kids: [] };
  for (const n of byId.values()) (byId.get(n.inside) ?? root).kids.push(n);
  for (const n of byId.values()) {
    n.you = (n.state.needs_you ? 1 : 0) + (n.within.needs_you ?? 0);
    n.blk = (n.state.blocked ? 1 : 0) + n.within.blocked;
  }
  return byId;
}
/** How much of a thing stays lit: what was asked for by name (style.only), else what the style's lit says. */
function litCount(n, style) {
  if (Array.isArray(style.only)) {
    const only = new Set(style.only);
    const any = (x) => only.has(x.id) || x.kids.some(any);
    return any(n) ? 1 : 0;
  }
  return style.lit === 'you' ? n.you : style.lit === 'blocked' ? n.blk : 1;
}

/** A step's outline, centred on x, y, its corners as round as rx. */
function outline(shape, x, y, w, hgt, rx) {
  const l = x - w / 2, r = x + w / 2, t = y - hgt / 2, b = y + hgt / 2;
  if (shape === 'diamond') return m('path', { d: `M${x} ${t}L${r} ${y}L${x} ${b}L${l} ${y}Z`, class: 'lf-shape' });
  if (shape === 'list') return m('rect', { x: l, y: t, width: w, height: hgt, rx, class: 'lf-shape' });
  if (shape === 'pill' || shape === 'end') return m('rect', { x: l, y: t, width: w, height: hgt, rx: hgt / 2, class: 'lf-shape' });
  // A document: a sheet whose foot is a wave.
  if (shape === 'sheet') return m('path', { d: `M${l} ${t}H${r}V${b - 5}C${r - w / 4} ${b - 13} ${x + w / 8} ${b + 5} ${x} ${b - 3}C${x - w / 8} ${b - 11} ${l + w / 4} ${b + 5} ${l} ${b - 3}Z`, class: 'lf-shape' });
  return m('rect', { x: l, y: t, width: w, height: hgt, rx: Math.min(rx, hgt / 5), class: 'lf-shape' });
}

/**
 * The process: its steps, the wires between them, the checklists and what each choice is. `input` is what the page
 * gives every drawing (the answer, the style, the titles of the types it holds); `tools.measure(text, px, font)` is
 * how wide a text is drawn.
 */
export function picture({ answer, style, types = {}, reduced }, tools) {
  // A story lays out what its steps bring in, all of it, each mark hidden until a step shows it.
  const story = Array.isArray(answer.steps) && answer.steps.length > 0;
  if (story) {
    const named = everyNamed(answer.steps);
    answer = { ...answer, items: answer.items.filter((i) => named.has(i.id) || i.id === answer.lens.from) };
  }
  const hidden = story ? { opacity: 0 } : {};
  const byId = lensTree(answer);
  // Every length is the style's (sizes, flow_*), named by the house style; so is the typeface.
  const z = (name) => {
    const v = style.sizes?.[`flow_${name}`];
    if (typeof v !== 'number') throw new Error(`The style names no size "flow_${name}": the house style (packs/core/pack.json) names every one a drawing uses`);
    return v;
  };
  const measure = (text, px) => tools.measure(text, px, style.font);
  const [LIST_HEAD, LIST_ROW, TEXT, STUB_TEXT, ROW_TEXT, CORNER] = ['list_head', 'list_row', 'text', 'stub_text', 'row_text', 'corner'].map(z);
  const fit = (text, width, px) => {
    if (measure(text, px) <= width) return text;
    let t = text;
    while (t.length > 1 && measure(`${t}…`, px) > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  const root = answer.items.find((i) => i.id === answer.lens.from);
  const g = layout({ items: answer.items, links: answer.links, rootId: root?.id, measure, sizes: style.sizes, numbers: style.numbers });
  const steps = g.all.filter((n) => !n.dummy);
  if (!steps.length) return { scene: { message: 'Nothing here depends on anything.' } };

  const yours = (i) => Boolean(i.state.needs_you);
  const dotOf = (i) => (!i.open ? 'done' : yours(i) ? 'you' : i.state.blocked ? 'blocked' : i.state.sessions ? 'session' : '');
  const words = (n) =>
    n.stub
      ? `${n.item.title}\nA choice nothing follows yet`
      : [n.item.title, n.item.status, n.item.state.blocked && 'Blocked', yours(n.item) ? 'Waits on you' : n.item.state.waits_on.length ? 'Waits on someone' : null, g.potential.has(n.id) && 'Only if that choice is made', ...(n.notes ?? []).map((i) => `On it: ${i.title}`)].filter(Boolean).join('\n');

  // What can be dimmed, by the item it is of; each step's key, for hovering.
  const dims = new Map(), keyed = new Map();
  // Wires, then the breaks cut across them, then the steps over both, then what each choice is.
  const wireLayer = g.chains.map((c, n) => {
    const [ex, ey] = c.points.at(-1);
    return [
      m('path', { key: `w:${n}`, d: `M${c.points.map((p) => p.join(' ')).join('L')}`, class: `lf-wire${c.dashed ? ' dashed' : ''}`, ...(story && { pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }), ...hidden }),
      m('path', { key: `h:${n}`, d: `M${ex} ${ey}L${ex - z('head_half')} ${ey - z('head_length')}L${ex + z('head_half')} ${ey - z('head_length')}Z`, class: 'lf-head', ...hidden }),
    ];
  });
  const breakLayer = g.breaks.map(([bx, by]) => m('g', { class: 'lf-break' }, m('rect', { x: bx - z('break_half'), y: by - z('break_reach'), width: 2 * z('break_half'), height: 2 * z('break_reach') }), m('path', { d: `M${bx - z('break_track')} ${by}H${bx + z('break_track')}` })));
  /** A checklist: its type and how many are left over a row for each thing, each row a link to its page. */
  const checklist = (n) => {
    const X = g.x.get(n.id), Y = g.y.get(n.id), top = Y - n.h / 2, left = X - n.w / 2;
    const open = n.list.filter((i) => i.open).length;
    const rows = n.list.map((i, k) => {
      const y = top + LIST_HEAD + k * LIST_ROW + LIST_ROW / 2;
      const row = titled(m('a', { key: `r:${i.id}`, href: `#/e/${i.id}`, class: `lf-row${i.open ? '' : ' closed'}${yours(i) ? ' you' : ''}` }, m('rect', { x: left + z('row_inset'), y: y - LIST_ROW / 2, width: n.w - 2 * z('row_inset'), height: LIST_ROW, class: 'lf-row-hit' }), m('circle', { cx: left + z('row_dot_x'), cy: y, r: z('dot_small'), class: `lf-dot ${dotOf(i)}` }), m('text', { x: left + z('row_text_x'), y }, fit(i.title, n.w - z('row_text_x') - z('row_text_after'), ROW_TEXT))), [i.title, i.status, i.state.blocked && 'Blocked', yours(i) && 'Waits on you'].filter(Boolean).join('\n'));
      dims.set(i.id, row);
      return row;
    });
    const key = `s:${n.id}`;
    keyed.set(key, n.id);
    return m('g', { key, on: ['enter', 'leave'], class: 'lf-step lf-list', ...hidden }, outline('list', X, Y, n.w, n.h, CORNER), m('text', { x: left + z('list_head_x'), y: top + LIST_HEAD / 2, class: 'lf-list-head' }, `${types[n.type] ?? n.type} · ${open} of ${n.list.length} open`), m('path', { d: `M${left} ${top + LIST_HEAD - z('list_rule_above')}H${left + n.w}`, class: 'lf-list-rule' }), rows);
  };
  const stepLayer = steps.map((n) => {
    if (n.shape === 'list') return checklist(n);
    const X = g.x.get(n.id), Y = g.y.get(n.id), i = n.item;
    const left = n.shape === 'diamond' ? X - n.w / 2 + z('diamond_pad') / 2 : X - n.w / 2 + (n.stub ? z('stub_text_x') : z('text_x'));
    const room = n.shape === 'diamond' ? n.w - z('diamond_pad') : n.w - (n.stub ? 2 * z('stub_text_x') : z('text_x') + z('text_after'));
    const cls = ['lf-step', n.stub && 'stub', (n.stub || g.potential.has(n.id)) && 'scenario', !i.open && 'closed', !n.stub && yours(i) && 'you', i.id === style.here && !n.stub && 'here'].filter(Boolean).join(' ');
    const body = [
      outline(n.shape, X, Y, n.w, n.h, CORNER),
      !n.stub && m('circle', { cx: left - z('dot_gap'), cy: Y, r: z('dot'), class: `lf-dot ${dotOf(i)}` }),
      m('text', { x: left, y: Y - (n.shape === 'sheet' ? z('sheet_lift') : 0) }, fit(i.title, room, n.stub ? STUB_TEXT : TEXT)),
      // Work on it that is not a step: a count on its corner, lit when some of it waits on you.
      n.notes && m('g', { class: `lf-badge${n.notes.some(yours) ? ' you' : ''}` }, m('circle', { cx: X + n.w / 2 - z('badge_in'), cy: Y - n.h / 2, r: z('badge') }), m('text', { x: X + n.w / 2 - z('badge_in'), y: Y - n.h / 2 }, String(n.notes.length))),
    ];
    const key = `s:${n.id}`;
    keyed.set(key, i.id);
    const el = titled(n.stub ? m('g', { key, on: ['enter', 'leave'], class: cls, ...hidden }, body) : m('a', { key, on: ['enter', 'leave'], href: `#/e/${i.id}`, class: cls, ...hidden }, body), words(n));
    if (!n.stub) dims.set(n.id, el);
    return el;
  });
  // What each choice is, written once beside the question's drop, halfway to its track; a pill already says it.
  const said = new Map();
  for (const c of g.chains) if (c.says && !g.nodes.get(c.b).stub) said.set(`${c.a} ${c.says}`, c);
  const saysLayer = [...said.values()].map((c) => {
    const d = g.nodes.get(c.a), text = fit(c.says, z('says_most'), z('says_text')), w = measure(text, z('says_text')) + 2 * z('says_pad');
    const lx = g.x.get(d.id) + w / 2 + z('says_aside'), ly = (g.y.get(d.id) + d.h / 2 + c.points[1][1]) / 2, sh = z('says_height');
    return titled(m('g', { key: `t:${g.chains.indexOf(c)}`, class: 'lf-says', ...hidden }, m('rect', { x: lx - w / 2, y: ly - sh / 2, width: w, height: sh, rx: sh / 2 }), m('text', { x: lx, y: ly }, text)), c.says);
  });
  const svg = m('svg', { viewBox: `0 0 ${g.width} ${g.height}`, role: 'img', 'aria-label': `A process of ${steps.length} steps` }, wireLayer, breakLayer, stepLayer, saysLayer);

  // The legend: only the marks this picture uses, one to a line.
  const mark = (inner, label) => m('span', {}, m('svg', { width: 22, height: 14, viewBox: '0 0 22 14' }, inner), label);
  const uses = (test) => steps.some(test);
  const legend = m(
    'div',
    { class: 'lf-legend' },
    [['box', 'Work'], ['list', 'Checklist'], ['diamond', 'Question'], ['pill', 'Event'], ['sheet', 'Record'], ['end', 'Possible end']].filter(([shape]) => uses((n) => n.shape === shape)).map(([shape, label]) => mark(m('g', { class: `lf-step${shape === 'end' ? ' scenario' : ''}` }, outline(shape, 11, 7, 20, shape === 'diamond' ? 12 : 11, CORNER)), label)),
    [['done', 'Done'], ['blocked', 'Blocked'], ['you', 'Waits on you'], ['session', 'Under way'], ['', 'Not started']].filter(([dot]) => uses((n) => !n.stub && (n.list ?? [n.item]).some((i) => dotOf(i) === dot))).map(([dot, label]) => mark(m('circle', { cx: 11, cy: 7, r: 4, class: `lf-dot ${dot}` }), label)),
    uses((n) => n.notes) && mark(m('g', { class: 'lf-badge' }, m('circle', { cx: 11, cy: 7, r: 6 })), 'Work on it'),
    mark(m('path', { d: 'M1 7H21', class: 'lf-wire' }), 'Leads to'),
    g.chains.some((c) => c.dashed) && mark(m('path', { d: 'M1 7H21', class: 'lf-wire dashed' }), 'If chosen'),
    g.breaks.length > 0 && mark(m('path', { d: 'M1 7H21M11 0V4M11 10V14', class: 'lf-wire' }), 'Passes under'),
  );

  // What stays lit, as the style says: the rest dimmed.
  const dimmed = (now) => [...dims.keys()].filter((id) => byId.has(id) && !litCount(byId.get(id), now));
  for (const id of dimmed(style)) addClass(dims.get(id), 'dim');
  /** Light the wires of a step, or of none. */
  const light = (id) => g.chains.flatMap((c, n) => [`w:${n}`, `h:${n}`].map((key) => ({ key, toggle: { lit: Boolean(id) && (c.a === id || c.b === id) } })));
  // Opened from an item's page, the picture is brought to that item; else to where the process starts.
  const start = g.nodes.has(style.here) ? style.here : steps.find((n) => !n.stub && n.layer === 0)?.id;
  // Told as a story: each step of the process shown as the story's steps bring it, on the stage of story.js.
  let player = null;
  if (story) {
    const idsOf = (id) => {
      const n = g.nodes.get(id);
      return n?.list ? n.list.map((i) => i.id) : [n?.item.id ?? id];
    };
    const marks = {
      steps: new Map(steps.map((n) => [`s:${n.id}`, idsOf(n.id)])),
      wires: g.chains.map((c, n) => ({ keys: [`w:${n}`, `h:${n}`], from: idsOf(c.a), to: idsOf(c.b), item: { from: c.a, to: c.b } })),
      says: new Map([...said.values()].map((c) => [g.chains.indexOf(c), `t:${g.chains.indexOf(c)}`])),
    };
    const frames = statesOf(answer.steps);
    player = play({ answer, style, reduced, tools, shape: { frames, stage: (ctx) => reveal({ frames, marks, ...ctx }) } });
  }
  return {
    scene: { css: story ? `${css}\n${storyCss}` : css, svg, legend, ...(player && { before: player.before, aside: player.after }), size: { width: g.width, height: g.height }, start: start ? [g.x.get(start), g.y.get(start)] : undefined },
    end: player?.end,
    on(event) {
      const { name, key } = event;
      if (player && (key === 'play' || key === 'chat' || key.startsWith('c:'))) return player.on(event);
      if (name === 'leave') return light(null);
      return keyed.has(key) ? light(keyed.get(key)) : [];
    },
    restyle(now) {
      const off = new Set(dimmed(now));
      return [...dims.keys()].filter((id) => byId.has(id)).map((id) => ({ key: dims.get(id)[1].key, toggle: { dim: off.has(id) } }));
    },
  };
}
