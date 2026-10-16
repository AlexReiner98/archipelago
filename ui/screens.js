// Screens: what a pack shows on the page of every item of a kind or type, as one column of pieces the kernel draws.
// The packs declare them in pack.json (`screens`); the kernel knows only the pieces: a tree, a gate, proof, usage,
// a figure, a document read whole, rows from a pack's view, a pack action's form, a short note. An action a pack
// offers on a kind or type is offered on the page of each such item too.

import { api, h, state } from './base.js';
import { renderBody } from './body.js';
import { gate } from './gate.js';
import { proofPart } from './proof.js';
import { roadmap } from './roadmap.js';
import { RAN, ago, chip, isA, label, link, pill, tokensText, unfolded } from './words.js';

/** The screens shown on an item of this type, in the order the packs load. */
export const screensFor = (typeId) => (state.schema?.screens ?? []).filter((s) => s.on.some((t) => isA(typeId, t)));
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
  const error = h('div', { class: 'error', style: 'padding: 0 14px 14px' });
  const form = h(
    'section',
    { class: 'card wide form', style: 'margin-bottom: 14px' },
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
  gate: (ctx) => !ctx.e.archived_at && { node: h('div', { id: 'gate', 'data-root': ctx.id }), later: () => gate(ctx.id) },
  proof: (ctx) => !ctx.e.archived_at && { node: h('div', { id: 'proof', 'data-root': ctx.id }), later: () => proofPart(ctx.id, true) },
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
    return tool && !ctx.e.archived_at && { node: actionForm(tool, ctx.id, ctx.redraw) };
  },
  note: (ctx, p) => ({ node: h('section', { class: 'card wide note' }, renderBody(p.text)) }),
  // Drawn with the note: the item's page reads them by name.
  figure: () => null,
  document: () => null,
};

/** The column of pieces the screens on this item draw, and what to run once it is on the page. */
export function drawScreens(ctx) {
  const drawn = piecesFor(ctx.e.type)
    .map((p) => PIECES[p.piece]?.(ctx, p))
    .filter(Boolean);
  return {
    column: h('div', { class: 'screens' }, drawn.map((d) => d.node)),
    after: () => {
      for (const d of drawn) d.later?.()?.catch?.((err) => d.node.isConnected && d.node.replaceChildren(h('div', { class: 'error' }, err.message)));
    },
  };
}
