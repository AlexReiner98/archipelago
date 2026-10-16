// A lens answer drawn as a grid.

import { h } from './base.js';
import { lensTree, litCount } from './lens.js';
import { card, kept, link, named, relations, types } from './words.js';

/** The colours a grid gives the values of the field it colours by, in the order the field declares them, when the style names none. */
export const GRID_HUES = ['#2e7d4f', '#2f5fb3', '#a86a12', '#6f43b0', '#59636e', '#0f7c86', '#b23a48', '#7a6a1c'];
/** A stored value as a person reads it: "set_up" is "Set up". */
export const inWords = (value) => (value == null ? 'Unfiled' : String(value).charAt(0).toUpperCase() + String(value).slice(1).replaceAll('_', ' '));

/**
 * A grid: rows are the things the start holds (what is in each, at any depth, is in its row; what the start holds
 * directly is a row of its own), columns are the lanes the lens files by, in the lens's order. Each thing is a card
 * that leads to its page, coloured by one of its shown fields (style.color_by), with a second line from another
 * (style.detail) and a date marked (style.mark). Links are drawn as lines between cards, each numbered, with its
 * words in a key under the grid. Reads only what a lens answers with.
 */
export function drawGrid(host, answer, style, keep, kept) {
  const { me, byId, root } = lensTree(answer);
  const start = byId.get(answer.lens.from) ?? root;
  const labels = style.labels && typeof style.labels === 'object' ? style.labels : {};
  const name = (value) => (typeof labels[value] === 'string' ? labels[value] : inWords(value));
  // Rows: each thing the start holds that holds others; then what the start holds directly.
  const groups = start.kids.filter((n) => n.kids.length > 0);
  const loose = start.kids.filter((n) => n.kids.length === 0);
  const under = (n) => n.kids.flatMap((kid) => (kid.kids.length ? under(kid) : [kid]));
  // Rows by a kind of link (style.rows link:<kind>): a row for each thing such links lead to, in the order the tree
  // gives them, a card in it for each thing that links there, with the link's words as its second line. A thing tied
  // to two is in both rows; things of the same kinds tied to none are a last row of their own.
  const byLink = typeof style.rows === 'string' && style.rows.startsWith('link:') ? style.rows.slice(5) : null;
  const order = new Map();
  const walk = (n) => (order.set(n.id, order.size), n.kids.forEach(walk));
  root.kids.forEach(walk);
  const says = new Map();
  let rows;
  if (byLink) {
    const tied = answer.links.filter((link) => link.kind === byLink && byId.has(link.from) && byId.has(link.to));
    const heads = [...new Set(tied.map((link) => link.to))].sort((a, b) => order.get(a) - order.get(b)).map((to) => byId.get(to));
    rows = heads.map((head) => ({
      head,
      cards: tied.filter((link) => link.to === head.id).map((link) => (link.says && says.set(`${head.id} ${link.from}`, link.says), byId.get(link.from))),
    }));
    const kinds = new Set(tied.map((link) => byId.get(link.from).type));
    const untied = [...byId.values()].filter((n) => kinds.has(n.type) && !tied.some((link) => link.from === n.id));
    if (untied.length) rows.push({ head: null, cards: untied });
  } else rows = [...groups.map((g) => ({ head: g, cards: under(g) })), ...(loose.length ? [{ head: null, cards: loose }] : [])];
  // Columns: the lanes in the lens's order, then any value it did not name, then what has none.
  const seen = [...new Set(rows.flatMap((r) => r.cards.map((n) => n.lane ?? null)))];
  const lanes = [...(answer.lanes ?? []), ...seen.filter((v) => v !== null && !(answer.lanes ?? []).includes(v)), ...(seen.includes(null) ? [null] : [])];
  // Colour: by a shown field, in the order its type declares the values; a style may name its own.
  const field = typeof style.color_by === 'string' ? style.color_by : null;
  const declared = field ? [...new Set(answer.items.flatMap((n) => types.get(n.type)?.fields?.[field]?.values ?? []))] : [];
  const palette = style.palette && typeof style.palette === 'object' ? style.palette : {};
  const hue = (value) => {
    const named = palette[value];
    if (typeof named === 'string' && /^#[0-9a-f]{3,8}$/i.test(named)) return named;
    const at = declared.indexOf(value);
    return GRID_HUES[(at < 0 ? declared.length + [...String(value)].length : at) % GRID_HUES.length];
  };
  const detail = typeof style.detail === 'string' ? style.detail : null;
  const markField = typeof style.mark === 'string' ? style.mark : null;
  const day = (value) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  // The links between two cards, numbered in the order the key gives them.
  const cardIds = new Set(rows.flatMap((r) => r.cards.map((n) => n.id)));
  // With rows by a kind of link, a card can stand in several rows: its links are the rows, and no lines are drawn.
  const lines = byLink ? [] : answer.links.filter((link) => cardIds.has(link.from) && cardIds.has(link.to) && link.kind !== answer.lens.by);
  const numbers = new Map();
  lines.forEach((link, i) => {
    for (const end of [link.from, link.to]) numbers.set(end, [...(numbers.get(end) ?? []), i + 1]);
  });

  const cardEls = new Map();
  const card = (n, head) => {
    const value = field ? n.fields?.[field] : undefined;
    const colour = value !== undefined ? hue(value) : 'var(--ln-line)';
    const date = markField && n.fields?.[markField];
    const note = markField && n.fields?.[`${markField}_note`];
    const el = h(
      'a',
      {
        class: `lg-card${litCount(n, style) ? '' : ' dim'}${n.open ? '' : ' closed'}${me && n.state.waits_on.includes(me) ? ' you' : ''}${n.id === style.here ? ' here' : ''}`,
        href: `#/e/${n.id}`,
        title: [n.title, value !== undefined && name(value), n.fields?.[detail], n.status].filter(Boolean).join('\n'),
        style: `--lg-hue: ${colour}`,
      },
      h('span', { class: 'lg-title' }, n.title),
      says.has(`${head?.id} ${n.id}`)
        ? h('span', { class: 'lg-detail', title: says.get(`${head.id} ${n.id}`) }, says.get(`${head.id} ${n.id}`))
        : detail && n.fields?.[detail] && h('span', { class: 'lg-detail' }, String(n.fields[detail])),
      (date || numbers.has(n.id)) &&
        h(
          'span',
          { class: 'lg-marks' },
          date && h('span', { class: 'lg-due', title: `${note ? `${note} ` : ''}${date}` }, `${note ? `${note} ` : ''}${day(date)}`),
          (numbers.get(n.id) ?? []).map((k) => h('span', { class: 'lg-num', title: lines[k - 1].says ?? relations.get(lines[k - 1].kind)?.title ?? lines[k - 1].kind }, String(k))),
        ),
    );
    cardEls.set(n.id, el);
    return el;
  };

  const grid = h('div', { class: 'lg-grid', style: `grid-template-columns: minmax(120px, 0.7fr) repeat(${lanes.length}, minmax(170px, 1fr)); min-width: ${120 + lanes.length * 176}px` });
  grid.append(h('div', { class: 'lg-corner' }), ...lanes.map((lane) => h('div', { class: 'lg-lane' }, name(lane))));
  for (const row of rows) {
    grid.append(
      row.head
        ? h('a', { class: 'lg-row', href: `#/e/${row.head.id}`, title: row.head.title }, row.head.title)
        : byLink
          ? h('div', { class: 'lg-row loose', title: `Tied to nothing by ${relations.get(byLink)?.title ?? byLink}` }, 'Not tied yet')
          : h('div', { class: 'lg-row loose', title: `What ${start.title} holds directly` }, 'Across all'),
    );
    for (const lane of lanes) grid.append(h('div', { class: 'lg-cell' }, row.cards.filter((n) => (n.lane ?? null) === lane).sort((a, b) => a.place - b.place || a.title.localeCompare(b.title)).map((n) => card(n, row.head))));
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'lg-lines');
  const stage = h('div', { class: 'lg-stage' }, grid, svg);
  const key = lines.length
    ? h(
        'ol',
        { class: 'lg-key' },
        lines.map((link) =>
          h(
            'li',
            { onmouseenter: () => light(link), onmouseleave: () => light(null) },
            h('span', { class: 'lg-said' }, link.says ?? `${byId.get(link.from).title} ${relations.get(link.kind)?.title ?? link.kind} ${byId.get(link.to).title}`),
            h('span', { class: 'muted small' }, ` ${byId.get(link.from).title} → ${byId.get(link.to).title}`),
          ),
        ),
      )
    : '';
  const legend = field && declared.length ? h('div', { class: 'lg-legend' }, declared.map((value) => h('span', { class: 'lg-swatch', style: `--lg-hue: ${hue(value)}` }, name(value)))) : '';
  const light = (link) => {
    for (const [id, el] of cardEls) el.classList.toggle('lg-off', Boolean(link) && id !== link.from && id !== link.to);
    for (const path of svg.querySelectorAll('g')) path.classList.toggle('lg-on', Boolean(link) && path.dataset.n === String(lines.indexOf(link) + 1));
  };

  // The lines are laid over the grid once it has its size, and again whenever it changes.
  const draw = () => {
    // Measured against the stage's whole scrolled area, so the lines stay on their cards when it scrolls sideways.
    const outer = stage.getBoundingClientRect();
    const box = { left: outer.left - stage.scrollLeft, top: outer.top - stage.scrollTop };
    svg.setAttribute('width', String(stage.scrollWidth));
    svg.setAttribute('height', String(stage.scrollHeight));
    svg.replaceChildren();
    const ns = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      return el;
    };
    const defs = make('defs', {});
    const head = make('marker', { id: 'lg-head', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    head.append(make('path', { d: 'M0 0 L10 5 L0 10 z', class: 'lg-arrow' }));
    defs.append(head);
    svg.append(defs);
    lines.forEach((link, i) => {
      const a = cardEls.get(link.from).getBoundingClientRect();
      const b = cardEls.get(link.to).getBoundingClientRect();
      const ax = a.left + a.width / 2 - box.left;
      const ay = a.top + a.height / 2 - box.top;
      const bx = b.left + b.width / 2 - box.left;
      const by = b.top + b.height / 2 - box.top;
      // From the edge of one card to the edge of the other, bowed so lines between neighbours do not lie on each other.
      const edge = (r, x, y, tx, ty) => {
        const dx = tx - x;
        const dy = ty - y;
        const t = Math.min(Math.abs(dx) > 0 ? r.width / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? r.height / 2 / Math.abs(dy) : Infinity);
        return [x + dx * Math.min(t, 1), y + dy * Math.min(t, 1)];
      };
      const [sx, sy] = edge(a, ax, ay, bx, by);
      const [ex, ey] = edge(b, bx, by, ax, ay);
      const mx = (sx + ex) / 2 - (ey - sy) * 0.15;
      const my = (sy + ey) / 2 + (ex - sx) * 0.15;
      const g = make('g', { 'data-n': i + 1 });
      const path = make('path', { d: `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`, class: 'lg-line', 'marker-end': 'url(#lg-head)' });
      const title = make('title', {});
      title.textContent = link.says ?? relations.get(link.kind)?.title ?? link.kind;
      path.append(title);
      const cx = (sx + 2 * mx + ex) / 4;
      const cy = (sy + 2 * my + ey) / 4;
      const dot = make('circle', { cx, cy, r: 9, class: 'lg-dot' });
      const num = make('text', { x: cx, y: cy + 4, class: 'lg-dotnum' });
      num.textContent = String(i + 1);
      g.append(path, dot, num);
      g.addEventListener('mouseenter', () => light(link));
      g.addEventListener('mouseleave', () => light(null));
      svg.append(g);
    });
  };
  host.replaceChildren(stage, legend, key);
  new ResizeObserver(() => requestAnimationFrame(draw)).observe(stage);
  // Opened from an item's page, the picture is brought to that item.
  if (style.here && cardEls.has(style.here)) requestAnimationFrame(() => cardEls.get(style.here).scrollIntoView({ block: 'center', inline: 'center' }));
  host.redraw = () => {
    for (const [id, el] of cardEls) el.classList.toggle('dim', !litCount(byId.get(id), style));
  };
}
