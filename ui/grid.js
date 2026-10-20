// A lens answer drawn as a grid.

import { h } from './base.js';
import { lensTree, litCount, sizeOf } from './lens-base.js';
import { relations, types } from './words.js';

/** The Time page's colours for projects, until pages are styled too (phase 2 of "Where does style live?"); a grid and a calendar take the style's hues. */
export const GRID_HUES = ['#2e7d4f', '#2f5fb3', '#a86a12', '#6f43b0', '#59636e', '#0f7c86', '#b23a48', '#7a6a1c'];
/** A stored value as a person reads it: "set_up" is "Set up". */
export const inWords = (value) => (value == null ? 'Unfiled' : String(value).charAt(0).toUpperCase() + String(value).slice(1).replaceAll('_', ' '));

/**
 * A grid: rows are the things the start holds (what is in each, at any depth, is in its row; what the start holds
 * directly is a row of its own), columns are the lanes the lens files by, in the lens's order. Each thing is a card
 * that leads to its page, coloured by one of its shown fields (style.color_by), with a second line from another
 * (style.detail) and a date marked (style.mark). A grid draws no lines: where a thing stands is its row and column.
 * Reads only what a lens answers with.
 */
export function drawGrid(host, answer, style, keep, kept) {
  const { me, byId, root } = lensTree(answer);
  const start = byId.get(answer.lens.from) ?? root;
  const labels = style.labels && typeof style.labels === 'object' ? style.labels : {};
  // Lanes by person come with names: the value is an id, never something to read.
  const declaredLanes = (answer.lanes ?? []).map((lane) => (lane && typeof lane === 'object' ? lane.key : lane));
  const laneNames = new Map((answer.lanes ?? []).filter((lane) => lane && typeof lane === 'object').map((lane) => [lane.key, lane.title]));
  const name = (value) => (typeof labels[value] === 'string' ? labels[value] : (laneNames.get(value) ?? inWords(value)));
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
  const lanes = [...declaredLanes.filter((v) => v !== null), ...seen.filter((v) => v !== null && !declaredLanes.includes(v)), ...(seen.includes(null) ? [null] : [])];
  // Colour: by a shown field, in the order its type declares the values; a style may name its own.
  const field = typeof style.color_by === 'string' ? style.color_by : null;
  const declared = field ? [...new Set(answer.items.flatMap((n) => types.get(n.type)?.fields?.[field]?.values ?? []))] : [];
  const palette = style.palette && typeof style.palette === 'object' ? style.palette : {};
  const hue = (value) => {
    const named = palette[value];
    if (typeof named === 'string' && /^#[0-9a-f]{3,8}$/i.test(named)) return named;
    const at = declared.indexOf(value);
    const hues = style.hues;
    return hues[(at < 0 ? declared.length + [...String(value)].length : at) % hues.length];
  };
  const detail = typeof style.detail === 'string' ? style.detail : null;
  const markField = typeof style.mark === 'string' ? style.mark : null;
  const day = (value) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
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
      date && h('span', { class: 'lg-marks' }, h('span', { class: 'lg-due', title: `${note ? `${note} ` : ''}${date}` }, `${note ? `${note} ` : ''}${day(date)}`)),
    );
    cardEls.set(n.id, el);
    return el;
  };

  const [head, lane, gap] = [sizeOf(style, 'grid_row_head'), sizeOf(style, 'grid_lane'), sizeOf(style, 'grid_gap')];
  const grid = h('div', { class: 'lg-grid', style: `grid-template-columns: minmax(${head}px, 0.7fr) repeat(${lanes.length}, minmax(${lane}px, 1fr)); min-width: ${head + lanes.length * (lane + gap)}px` });
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

  const stage = h('div', { class: 'lg-stage' }, grid);
  const legend = field && declared.length ? h('div', { class: 'lg-legend' }, declared.map((value) => h('span', { class: 'lg-swatch', style: `--lg-hue: ${hue(value)}` }, name(value)))) : '';
  host.replaceChildren(stage, legend);
  // Opened from an item's page, the picture is brought to that item.
  if (style.here && cardEls.has(style.here)) requestAnimationFrame(() => cardEls.get(style.here).scrollIntoView({ block: 'center', inline: 'center' }));
  host.redraw = () => {
    for (const [id, el] of cardEls) el.classList.toggle('dim', !litCount(byId.get(id), style));
  };
}
