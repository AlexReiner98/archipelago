// Screens: what a pack shows on the page of every item of a kind or type, as one column of pieces the kernel draws.
// The packs declare them in pack.json (`screens`); the kernel knows only the pieces: a tree, a gate, proof, usage,
// a figure, a document read whole, rows from a pack's view, a pack action's form, a short note. An action a pack
// offers on a kind or type is offered on the page of each such item too.

import { api, h, state } from './base.js';
import { renderBody } from './body.js';
import { attentionCard } from './attention.js';
import { canvasesPiece } from './canvases.js';
import { drawDiagram } from './diagram.js';
import { heldPiece } from './held.js';
import { startPiece } from './start.js';
import { gate } from './gate.js';
import { proofPart } from './proof.js';
import { flatView } from './lens.js';
import { keptView } from './canvases.js';
import { roadmap } from './roadmap.js';
import { time } from './time.js';
import { tokenPiece } from './token-piece.js';
import { tokenAskPiece } from './token-ask.js';
import { RAN, ago, chip, isA, label, link, pill, tokensText, unfolded } from './words.js';

/** The screens shown on an item of this type, in the order the packs load. */
export const screensFor = (typeId) => (state.schema?.screens ?? []).filter((s) => s.on?.some((t) => isA(typeId, t)));
/** The pieces of those screens, each with the screen it is part of. */
const piecesFor = (typeId) => screensFor(typeId).flatMap((s) => s.pieces.map((p) => ({ ...p, screen: s })));
/** The tree a screen draws on an item of this type, if one does. */
export const treeFor = (typeId) => piecesFor(typeId).find((p) => p.piece === 'tree')?.tree;
/** Whether an item of this type is read whole, its text with what it brings in, in place of its note. */
export const readWhole = (typeId) => piecesFor(typeId).some((p) => p.piece === 'document');
/** Whether an item of this type keeps a figure, shown with its note. */
export const keepsFigure = (typeId) => piecesFor(typeId).some((p) => p.piece === 'figure');
/** The actions packs offer on an item of this type, as the schema lists them. */
export const actionsFor = (typeId) => (state.schema?.pack_tools ?? []).filter((t) => t.action && t.on?.some((on) => isA(typeId, on)));

/** A section that is not the point of the page: one line until it is asked for, and kept open or shut while the page is open. */
export const fold = (id, key, title, n, open, content) =>
  h(
    'details',
    { class: 'card wide fold', open: unfolded.get(`${id}:${key}`) ?? open, ontoggle: (ev) => unfolded.set(`${id}:${key}`, ev.target.open) },
    h('summary', {}, h('h2', {}, title), n ? h('span', { class: 'n' }, n) : ''),
    content,
  );

/** A form for a pack's action, from the JSON Schema of its input. The item's id goes in the input the action names. */
export function actionForm(tool, id, done) {
  const props = tool.input?.properties ?? {};
  const required = new Set(tool.input?.required ?? []);
  const numeric = (def) => def.type === 'number' || def.type === 'integer';
  const control = (key, def) =>
    def.enum
      ? h('select', { name: key }, !required.has(key) && h('option', { value: '' }, '(not set)'), def.enum.map((v) => h('option', { value: v }, v)))
      : def.type === 'boolean'
        ? h('select', { name: key }, [['', '(not set)'], ['true', 'yes'], ['false', 'no']].map(([v, text]) => h('option', { value: v }, text)))
        : h('input', { type: numeric(def) ? 'number' : 'text', name: key });
  const fields = Object.entries(props).filter(([key]) => key !== tool.item);
  const error = h('div', { class: 'error', style: 'padding: 0 var(--space-8) var(--space-8)' });
  const form = h(
    'section',
    { class: 'card wide form', style: 'margin-bottom: var(--space-8)' },
    h('header', {}, h('h2', { title: `From the ${tool.pack} pack` }, tool.title ?? tool.tool)),
    fields.length > 0 && h('dl', { class: 'fields' }, fields.map(([key, def]) => [h('dt', { title: def.description ?? '', class: def.description ? 'hinted' : '' }, `${label(key)}${required.has(key) ? ' *' : ''}`), h('dd', {}, control(key, def))])),
    error,
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          class: 'primary',
          onclick: async (ev) => {
            const input = tool.item ? { [tool.item]: id } : {};
            for (const el of form.querySelectorAll('[name]')) {
              if (el.value === '') continue;
              const def = props[el.name];
              input[el.name] = def.type === 'boolean' ? el.value === 'true' : numeric(def) ? Number(el.value) : el.value;
            }
            ev.target.disabled = true;
            try {
              await api(tool.tool, input);
              done();
            } catch (err) {
              error.textContent = err.message;
              ev.target.disabled = false;
            }
          },
        },
        tool.title ?? 'Do it',
      ),
      h('button', { onclick: done }, 'Cancel'),
    ),
  );
  return form;
}

/** One row a pack's view answered: an item by its name, or a line of text. */
const viewRow = (row) =>
  h('li', { class: 'row-top' }, row && typeof row === 'object' && row.id ? [row.type && chip(row.type), h('span', { class: 'grow', title: row.title ?? '' }, link(row)), row.status && row.type && pill(row.type, row.status)] : h('span', { class: 'grow', title: String(row) }, String(row)));

/** What the agents working in a repository have used: the sync agent in GitHub Actions, and sessions on a machine. */
async function usage(host, id) {
  const used = await api('view', { name: 'agent_usage', params: { repo: id } }).catch(() => null);
  if (!used?.runs.length || !host.isConnected) return host.remove();
  host.replaceWith(
    fold(id, 'usage', 'Tokens used here', `${tokensText(Object.values(used.month).reduce((sum, u) => sum + u.tokens, 0))} in 30 days`, false, [
      h(
        'div',
        { class: 'toolbar fold-bar usage-sums', title: 'The last 30 days, by where the agents ran' },
        Object.entries(used.month).map(([where, u]) =>
          h('span', { class: 'fact' }, h('span', { class: 'muted' }, `${RAN[where] ?? where} `), h('strong', {}, tokensText(u.tokens)), h('span', { class: 'muted' }, ` in ${u.runs} run${u.runs === 1 ? '' : 's'}${u.cost_usd > 0 ? ` · $${u.cost_usd.toFixed(2)}` : ''}`)),
        ),
      ),
      used.runs.map((run) =>
        h(
          'div',
          { class: 'change line' },
          h('span', { class: 'chip' }, RAN[run.surface] ?? run.surface),
          h('span', { class: 'gist', title: run.title }, h('a', { href: `#/e/${run.id}` }, run.title)),
          run.status === 'failed' && h('span', { class: 'pill bad' }, 'failed'),
          h('span', { class: 'muted small' }, `${tokensText(run.tokens)}${run.cost_usd ? ` · $${run.cost_usd.toFixed(2)}` : ''}`),
          ago(run.at),
        ),
      ),
    ]),
  );
}

/** Rows from a pack's view of this item. */
async function rows(host, id, p) {
  const tool = (state.schema?.pack_tools ?? []).find((t) => t.view === p.view);
  if (!tool) return host.remove();
  try {
    const answer = await api(tool.tool, p.item ? { [p.item]: id } : {});
    const list = Array.isArray(answer) ? answer : [];
    // On a screen of its own (Home), a list with nothing in it is not drawn.
    if (!list.length && !id) return host.remove();
    host.replaceWith(fold(id, p.screen.id, p.screen.title, list.length, true, list.length ? h('ul', { class: 'rows' }, list.map(viewRow)) : h('div', { class: 'empty' }, 'Nothing here.')));
  } catch (err) {
    host.replaceChildren(h('div', { class: 'error' }, err.message));
  }
}

/**
 * Each piece the kernel draws. A piece answers what goes in the column at once; what must be fetched fills it
 * afterwards (`later`), once it is on the page.
 */
const PIECES = {
  tree: (ctx, p) => ({ node: h('div', { id: 'roadmap', 'data-root': ctx.id, 'data-tree': p.tree }), later: () => roadmap(ctx.id) }),
  gate: (ctx) => !ctx.e?.archived_at && { node: h('div', { id: 'gate', 'data-root': ctx.id }), later: () => gate(ctx.id) },
  proof: (ctx) => !ctx.e?.archived_at && { node: h('div', { id: 'proof', 'data-root': ctx.id }), later: () => proofPart(ctx.id, true) },
  usage: (ctx) => {
    const node = h('div');
    return { node, later: () => usage(node, ctx.id) };
  },
  view: (ctx, p) => {
    const node = h('div');
    return { node, later: () => rows(node, ctx.id, p) };
  },
  action: (ctx, p) => {
    const tool = (state.schema?.pack_tools ?? []).find((t) => t.action === p.action);
    return tool && !ctx.e?.archived_at && { node: actionForm(tool, ctx.id, ctx.redraw) };
  },
  // What needs attention: for you, and on an item's page only what is that item's.
  attention: (ctx, p) => {
    const node = h('div');
    const params = { ...(p.person && { person: p.person }), ...(p.reasons && { reasons: p.reasons }), ...(ctx.id && { within: ctx.id }) };
    return { node, later: () => attentionCard(node, params, p.title ?? p.screen.title, Boolean(ctx.id), p.limit) };
  },
  note: (ctx, p) => ({ node: h('section', { class: 'card wide note' }, renderBody(p.text)) }),
  // A picture: a view kept on the map (by its id), or a flat lens where "{here}" is the item the page is of. A style
  // named by id is read by the server; one written into the screen is its fields only, never code.
  picture: (ctx, p) => {
    const key = `screen:${p.screen.id}:${ctx.id ?? ''}`;
    const { code, ...style } = typeof p.style === 'object' && p.style ? p.style : {};
    if (typeof p.style === 'string') style.style = p.style;
    // A screen that names its shape is drawn in it, not by the code of a style the workspace keeps for every picture.
    if (style.shape) style.code = '';
    const here = (term) => (term.includes('{here}') && !ctx.id ? null : term.replaceAll('{here}', ctx.id));
    const filter = typeof p.lens === 'object' && p.lens ? { ...p.lens.filter } : {};
    for (const k of ['find', 'only', 'not']) if (filter[k]) filter[k] = filter[k].map(here);
    if (Object.values(filter).some((v) => Array.isArray(v) && v.includes(null))) return null;
    const view = typeof p.lens === 'string' ? keptView(p.lens, { key, style }) : flatView({ lens: { ...p.lens, filter }, style, of: ctx.id, key, only: p.only, quiet: true });
    return { node: h('section', { class: 'card wide lens-card', style: 'margin-bottom: var(--space-8)' }, h('header', {}, h('h2', {}, p.title ?? p.screen.title)), view) };
  },
  // Some of the item's fields, together under the screen's name.
  fields: (ctx, p) => {
    const set = (p.fields ?? []).filter((f) => ctx.e && ctx.e.props[f] !== undefined && ctx.e.props[f] !== null && ctx.e.props[f] !== '');
    return set.length > 0 && { node: h('section', { class: 'card wide' }, h('header', {}, h('h2', {}, p.screen.title)), h('dl', { class: 'fields' }, set.map((f) => [h('dt', {}, label(f)), h('dd', { class: 'gist', title: String(ctx.e.props[f]) }, String(ctx.e.props[f]))]))) };
  },
  // A page the kernel still draws itself, as its own part, until a pack draws it from pieces.
  page: (ctx, p) => PAGES[p.page] && { node: h('div', { class: 'part', 'data-part': p.page }), later: PAGES[p.page] },
  // Tokens within the item: made here, listed and revoked here.
  token: (ctx) => {
    const node = h('div');
    return { node, later: () => tokenPiece(node, ctx.e, fold) };
  },
  // Systems asking for a token: on an item's page those about it, on a screen of its own all of them.
  token_ask: (ctx) => {
    const node = h('div');
    return { node, later: () => tokenAskPiece(node, ctx.e) };
  },
  // The changes that wait for the owner's word: a table on Home, left out when none wait.
  // A new workspace's first steps, for its admin: left out once they are done or hidden.
  start: (ctx, p) => {
    const node = h('div');
    return { node, later: () => startPiece(node, p.title ?? p.screen.title) };
  },
  held: (ctx, p) => {
    const node = h('div');
    return { node, later: () => heldPiece(node, p.title ?? p.screen.title) };
  },
  // The saved canvases, one line each, opening in one click (ui/canvases.js).
  saved_views: (ctx, p) => {
    const node = h('div');
    return { node, later: () => canvasesPiece(node, p.title ?? p.screen.title) };
  },
  // Drawn with the note: the item's page reads them by name.
  // A diagram made from the code: the boxes and wires the item keeps, with its draw.io file at the commit it came from.
  diagram: (ctx) => {
    const node = h('section', { class: 'card wide lens-card' });
    return { node, later: () => drawDiagram(node, ctx.e?.props?.diagram, { download: ctx.e?.props?.diagram?.drawio }) };
  },
  figure: () => null,
  document: () => null,
};

/** The commit the server ran when this page's code was loaded: a piece this code does not know is newer than it. */
const loadedWith = fetch('/health').then((r) => r.json()).then((x) => x.commit, () => undefined);

/** A piece this page cannot draw is never skipped in silence: newer than the page's code, it asks for a reload. */
const unknownPiece = (p) => {
  const node = h('div');
  const later = async () => {
    const [then, now] = await Promise.all([loadedWith, fetch('/health').then((r) => r.json()).then((x) => x.commit, () => undefined)]);
    const stale = Boolean(now && then !== now);
    node.replaceChildren(
      h(
        'section',
        { class: 'card wide', style: 'margin-bottom: var(--space-8)' },
        h(
          'div',
          { class: 'toolbar fold-bar' },
          h('span', { class: 'grow gist muted', title: stale ? `The server runs ${now.slice(0, 7)}; this page was loaded with ${then?.slice(0, 7) ?? 'older code'}` : `No piece named "${p.piece}" here` }, `${p.title ?? p.screen?.title ?? p.piece}: not drawn`),
          stale ? h('button', { class: 'primary', title: 'This page is older than the server', onclick: () => location.reload() }, 'Reload') : h('span', { class: 'pill warn' }, p.piece),
        ),
      ),
    );
  };
  return { node, later };
};
/** A piece drawn as the kernel draws it, or as a stub when this page does not know it. */
const draw = (ctx, p) => (Object.hasOwn(PIECES, p.piece) ? PIECES[p.piece](ctx, p) : unknownPiece(p));

/** The pages the kernel still draws itself (src/declared.ts lists them). */
const PAGES = { time };

/** A piece that draws something of an item has nothing to draw on a screen of its own. */
const OF_ITEM = ['tree', 'gate', 'proof', 'usage', 'fields', 'token'];

/** The column a screen of its own draws: its pieces, with no item. */
export function drawScreen(screen, redraw) {
  const ctx = { e: null, id: null, redraw };
  const drawn = screen.pieces
    .filter((p) => !OF_ITEM.includes(p.piece) && !(p.piece === 'view' && p.item))
    .map((p) => draw(ctx, { ...p, screen }))
    .filter(Boolean);
  return settle(drawn);
}

/** The nodes in a column, and what to run once it is on the page. */
const settle = (drawn) => ({
  column: h('div', { class: 'screens' }, drawn.map((d) => d.node)),
  // Answers once every piece is filled: a page drawn again in place shows them then.
  after: () => Promise.all(drawn.map((d) => Promise.resolve(d.later?.()).catch((err) => d.node.isConnected && d.node.replaceChildren(h('div', { class: 'error' }, err.message))))),
});

/** The column of pieces the screens on this item draw, and what to run once it is on the page. */
/** The packs an item uses: those of its type and what it is a flavour of, and of what it is linked to and by what. */
function packsUsed(data) {
  const types = new Map((state.schema?.types ?? []).map((t) => [t.id, t]));
  const relations = new Map((state.schema?.relations ?? []).map((r) => [r.id, r]));
  const used = new Set();
  const take = (typeId) => {
    for (let t = types.get(typeId); t; t = types.get(t.flavour_of)) used.add(t.pack);
  };
  take(data.entity.type);
  for (const r of [...(data.outgoing ?? []), ...(data.incoming ?? [])]) {
    take(r.entity_type);
    used.add(relations.get(r.type)?.pack);
  }
  return used;
}

/** A pack's pieces show on an item only once the item uses that pack; the core's and the owner's own always do. */
export function drawScreens(ctx) {
  const used = packsUsed(ctx.data);
  const drawn = piecesFor(ctx.e.type)
    .filter((p) => !p.screen.pack || p.screen.pack === 'core' || used.has(p.screen.pack))
    .map((p) => draw(ctx, p))
    .filter(Boolean);
  return settle(drawn);
}
