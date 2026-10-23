// A lens answer drawn as a grid: rows are the things the start holds (what is in each, at any depth, is in its row;
// what the start holds directly is a row of its own), columns are the lanes the lens files by, in the lens's order.
// Each thing is a card that leads to its page, coloured by one of its shown fields (style.color_by), with a second
// line from another (style.detail) and a date marked (style.mark). A grid draws no lines: where a thing stands is its
// row and column. It is laid out by the page, not drawn to a size: the frame does not pan or zoom it. Its look is
// ./look.js. A lens with steps tells the grid as it fills (./story.js), the conversation beside it.

import { columnsClass, columnsRule, css, hueClass, hueRule } from './look.js';
import { m } from './marks.js';
import { play } from './play.js';
import { css as storyCss, everyNamed, reveal, statesOf } from './story.js';

/** A stored value as a person reads it: "set_up" is "Set up". */
const inWords = (value) => (value == null ? 'Unfiled' : String(value).charAt(0).toUpperCase() + String(value).slice(1).replaceAll('_', ' '));
const HEX = /^#[0-9a-f]{3,8}$/i;

/** A lens answer as a tree, each thing with what it says of itself and of all that is inside it. */
function lensTree(answer) {
  const byId = new Map(answer.items.map((item) => [item.id, { ...item, kids: [] }]));
  const root = { kids: [], title: 'Everything' };
  for (const n of byId.values()) (byId.get(n.inside) ?? root).kids.push(n);
  for (const n of byId.values()) {
    n.you = (n.state.needs_you ? 1 : 0) + (n.within.needs_you ?? 0);
    n.blk = (n.state.blocked ? 1 : 0) + n.within.blocked;
  }
  const sort = (n) => (n.kids.sort((a, b) => a.place - b.place), n.kids.forEach(sort));
  sort(root);
  return { byId, root };
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

/**
 * The grid. `input` is what the page gives every drawing: the answer, the style, the enum values each type it holds
 * declares (`fields`, by type then field) and the titles of the links it holds (`relations`).
 */
export function picture({ answer, style, fields = {}, relations = {}, reduced }, tools) {
  // A story lays out what its steps bring in, and what holds it, each mark hidden until a step shows it.
  const story = Array.isArray(answer.steps) && answer.steps.length > 0;
  if (story) {
    const named = everyNamed(answer.steps), inside = new Map(answer.items.map((i) => [i.id, i.inside]));
    const kept = new Set();
    for (let id of named) while (id && !kept.has(id)) (kept.add(id), (id = inside.get(id)));
    answer = { ...answer, items: answer.items.filter((i) => kept.has(i.id) || i.id === answer.lens.from) };
  }
  const size = (name) => {
    const v = style.sizes?.[name];
    if (typeof v !== 'number') throw new Error(`The style names no size "${name}": the house style (packs/core/pack.json) names every one a drawing uses`);
    return v;
  };
  const { byId, root } = lensTree(answer);
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
  const declared = field ? [...new Set(answer.items.flatMap((n) => fields[n.type]?.[field] ?? []))] : [];
  const palette = style.palette && typeof style.palette === 'object' ? style.palette : {};
  const hue = (value) => {
    const named = palette[value];
    if (typeof named === 'string' && HEX.test(named)) return named;
    const at = declared.indexOf(value);
    const hues = style.hues;
    return hues[(at < 0 ? declared.length + [...String(value)].length : at) % hues.length];
  };
  // Each colour drawn is a class with a rule of its own; one that is not a plain hex colour is the line's.
  const rules = new Set();
  const hueOf = (value) => {
    const hex = hue(value);
    if (typeof hex !== 'string' || !HEX.test(hex)) return 'lg-h-none';
    rules.add(hueRule(hex));
    return hueClass(hex);
  };
  const detail = typeof style.detail === 'string' ? style.detail : null;
  const markField = typeof style.mark === 'string' ? style.mark : null;
  const day = (value) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  // Every card drawn, by the item it is of (a thing tied to two rows is two cards); each row's head and each lane's.
  const cards = new Map(), heads = new Map(), laneKeys = new Map();
  // In a story, each waits hidden until a step brings it.
  const off = story ? ' sp-off' : '';
  const card = (n, head, r) => {
    const value = field ? n.fields?.[field] : undefined;
    const date = markField && n.fields?.[markField];
    const note = markField && n.fields?.[`${markField}_note`];
    const key = `g:${r}:${n.id}`;
    if (!cards.has(n.id)) cards.set(n.id, []);
    cards.get(n.id).push({ key, lane: n.lane ?? null });
    const said = says.get(`${head?.id} ${n.id}`);
    return m(
      'a',
      {
        key,
        class: `lg-card${litCount(n, style) ? '' : ' dim'}${n.open ? '' : ' closed'}${n.state.needs_you ? ' you' : ''}${n.id === style.here ? ' here' : ''}${off} ${value !== undefined ? hueOf(value) : 'lg-h-none'}`,
        href: `#/e/${n.id}`,
        title: [n.title, value !== undefined && name(value), n.fields?.[detail], n.status].filter(Boolean).join('\n'),
      },
      m('span', { class: 'lg-title' }, n.title),
      said ? m('span', { class: 'lg-detail', title: said }, said) : detail && n.fields?.[detail] && m('span', { class: 'lg-detail' }, String(n.fields[detail])),
      date && m('span', { class: 'lg-marks' }, m('span', { class: 'lg-due', title: `${note ? `${note} ` : ''}${date}` }, `${note ? `${note} ` : ''}${day(date)}`)),
    );
  };

  const [head, lane, gap] = [size('grid_row_head'), size('grid_lane'), size('grid_gap')];
  rules.add(columnsRule(lanes.length, head, lane, gap));
  const cells = [m('div', { class: 'lg-corner' }), ...lanes.map((value, k) => (laneKeys.set(k, value), m('div', { key: `l:${k}`, class: `lg-lane${off}` }, name(value))))];
  rows.forEach((row, r) => {
    const key = `r:${r}`;
    heads.set(key, row);
    cells.push(
      row.head
        ? m('a', { key, class: `lg-row${off}`, href: `#/e/${row.head.id}`, title: row.head.title }, row.head.title)
        : byLink
          ? m('div', { key, class: `lg-row loose${off}`, title: `Tied to nothing by ${relations[byLink] ?? byLink}` }, 'Not tied yet')
          : m('div', { key, class: `lg-row loose${off}`, title: `What ${start.title} holds directly` }, 'Across all'),
    );
    lanes.forEach((value, k) => cells.push(m('div', { ...(story && { key: `x:${r}:${k}` }), class: `lg-cell${off}` }, row.cards.filter((n) => (n.lane ?? null) === value).sort((a, b) => a.place - b.place || a.title.localeCompare(b.title)).map((n) => card(n, row.head, r)))));
  });
  const grid = m('div', { class: 'lg-stage' }, m('div', { class: `lg-grid ${columnsClass(lanes.length, head, lane, gap)}` }, cells));
  const legend = field && declared.length ? m('div', { class: 'lg-legend' }, declared.map((value) => m('span', { class: `lg-swatch ${hueOf(value)}` }, m('span', { class: 'lg-chip' }), name(value)))) : null;

  // Told as a story: each card, row and lane shown as the story's steps bring what it is of, on the stage of story.js.
  let player = null;
  if (story) {
    const frames = statesOf(answer.steps);
    const marks = {
      cards: [...cards].flatMap(([id, list]) => list.map((c) => ({ key: c.key, ids: [id], lane: c.lane }))),
      rows: [...heads].map(([key, row], r) => ({ key, cells: lanes.map((_, k) => `x:${r}:${k}`), ids: [...(row.head ? [row.head.id] : []), ...row.cards.map((n) => n.id)] })),
      lanes: [...laneKeys].map(([k, value]) => ({ key: `l:${k}`, value })),
    };
    player = play({ answer, style, reduced, tools, shape: { frames, stage: (ctx) => reveal({ frames, marks, ...ctx }) } });
  }
  const look = [css, ...rules, story ? storyCss : ''].join('\n');
  return {
    scene: { css: look, svg: grid, legend, ...(player && { before: player.before, aside: player.after }), ...(cards.has(style.here) && { focus: cards.get(style.here)[0].key }) },
    end: player?.end,
    on(event) {
      if (player && (event.key === 'play' || event.key.startsWith('c:'))) return player.on(event);
      return [];
    },
    restyle(now) {
      return [...cards].flatMap(([id, list]) => list.map((c) => ({ key: c.key, toggle: { dim: !litCount(byId.get(id), now) } })));
    },
  };
}
