import { api, h, state, tell } from './base.js';
import { graphView } from './graph.js';
import { chip, isClosed, link, menu, pill, statusesOf } from './words.js';

// ---- Roadmap -------------------------------------------------------------

// Which features are unfolded, kept across redraws.
export const roadmapOpen = new Set();

export function progressBar({ done, total }) {
  if (!total) return h('span', { class: 'muted small nowrap' }, 'no tasks');
  return h('span', { class: 'progress', title: `${done} of ${total} tasks and issues closed` }, h('span', { class: 'bar' }, h('span', { style: `width: ${Math.round((done / total) * 100)}%` })), h('span', { class: 'muted small' }, `${done}/${total}`));
}

export const roadmapState = {
  get graph() {
    try {
      return localStorage.getItem('pelago-roadmap-as') !== 'list';
    } catch {
      return true;
    }
  },
  set graph(value) {
    try {
      localStorage.setItem('pelago-roadmap-as', value ? 'graph' : 'list');
    } catch {
      // Without storage the graph is shown each time.
    }
  },
  // Features alone are the overview; their tasks are one tick away.
  work: false,
};

export async function roadmap(rootId) {
  const main = document.getElementById('roadmap');
  // Drawn only on the page of the project it is the roadmap of, from the tree its screen names.
  if (main?.dataset.root !== rootId) return;
  const tree = main.dataset.tree;
  // What its branches are: a new one is made of the first of them.
  const branchType = state.schema.trees.find((t) => t.id === tree)?.branches[0];
  const data = await api('view', { name: 'tree', params: { tree, root: rootId } });
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      roadmap(rootId);
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  // Moving one feature renumbers its siblings, so the order is always 1, 2, 3.
  const move = (siblings, from, to) => {
    const next = [...siblings];
    next.splice(to, 0, ...next.splice(from, 1));
    change(next.map((b, i) => (b.order === i + 1 ? null : { op: 'update', id: b.id, props: { order: i + 1 } })).filter(Boolean), 'Roadmap order changed in the UI');
  };
  const working = (x) => x.sessions.map((s) => h('a', { class: 'pill ok', href: `#/e/${s.id}`, title: s.title }, 'session open'));
  const workRow = (w) => h('li', { class: `row-top${w.open ? '' : ' finished'}` }, chip(w.type), h('span', { class: 'grow' }, link(w)), w.blocked && h('span', { class: 'pill bad' }, 'blocked'), working(w), pill(w.type, w.status));
  const branch = (b, i, siblings) =>
    h(
      'li',
      { class: b.active ? 'active' : '' },
      h(
        'details',
        { open: roadmapOpen.has(b.id), ontoggle: (e) => (e.target.open ? roadmapOpen.add(b.id) : roadmapOpen.delete(b.id)) },
        h(
          'summary',
          {},
          h('span', { class: 'place muted' }, i + 1),
          h('span', { class: 'grow' }, link(b)),
          b.blocked && h('span', { class: 'pill bad' }, 'blocked'),
          working(b),
          progressBar(b.progress),
          pill(b.type, b.status),
          h('span', { class: 'moves' }, h('button', { title: 'Earlier', disabled: i === 0, onclick: (e) => (e.preventDefault(), move(siblings, i, i - 1)) }, '↑'), h('button', { title: 'Later', disabled: i === siblings.length - 1, onclick: (e) => (e.preventDefault(), move(siblings, i, i + 1)) }, '↓')),
        ),
        b.branches.length > 0 && h('ul', { class: 'tree' }, b.branches.map(branch)),
        b.work.length > 0 && h('ul', { class: 'rows work' }, b.work.map(workRow)),
        !b.branches.length && !b.work.length && h('div', { class: 'empty' }, 'Nothing is part of this feature yet. Open a task and add "is part of" this feature, or move one here from the list below.'),
      ),
    );

  const flat = (bs) => bs.flatMap((b) => [b, ...flat(b.branches)]);
  const features = flat(data.branches);
  const title = h('input', { type: 'text', placeholder: 'A new feature', style: 'flex: 1; min-width: var(--input-wide)' });
  const add = () =>
    title.value.trim() &&
    change(
      [
        { op: 'create', ref: 'f', type: branchType, title: title.value.trim(), props: { order: data.branches.length + 1 } },
        { op: 'link', type: 'part_of', from: 'f', to: rootId },
      ],
      'Feature added to the roadmap in the UI',
    );
  const statuses = statusesOf(branchType).filter((st) => data.by_status[st]);
  const asGraph = roadmapState.graph;
  // What the roadmap knows that the graph does not: each feature's progress and place, what is being worked on,
  // and a feature that waits on another only through their tasks.
  const info = new Map([[rootId, { progress: data.progress }]]);
  const featureOf = new Map();
  const learn = (b, i) => {
    info.set(b.id, { progress: b.progress, place: i + 1, active: b.active, sessions: b.sessions });
    featureOf.set(b.id, b.id);
    for (const w of b.work) {
      featureOf.set(w.id, b.id);
      info.set(w.id, { active: w.active, sessions: w.sessions });
    }
    b.branches.forEach(learn);
  };
  data.branches.forEach(learn);
  const through = data.depends
    .map((d) => ({ from: featureOf.get(d.from), to: featureOf.get(d.to), direct: featureOf.get(d.from) === d.from && featureOf.get(d.to) === d.to }))
    .filter((d) => d.from && d.to && d.from !== d.to && !d.direct)
    .map((d) => ({ id: `through:${d.from}:${d.to}`, type: 'depends_on', from: d.from, to: d.to, lifted: true }));
  const inProgress = menu(`${data.now.length} in progress`, data.now.map((n) => [`${n.title}${n.sessions?.length ? '  · session open' : ''}`, () => (location.hash = `#/e/${n.id}`)]));
  inProgress.classList.add('ok');
  if (!main.isConnected) return;

  main.replaceChildren(
    h(
      'div',
      { class: 'grid' },
        h(
        'section',
        { class: 'card wide' },
        h(
          'header',
          { class: 'bar' },
          h('h2', {}, 'Features'),
          progressBar(data.progress),
          statuses.map((st) => h('span', { class: `pill${isClosed(branchType, st) ? ' closed' : ''}` }, `${data.by_status[st]} ${st}`)),
          h('span', { class: 'grow' }),
          // What is being worked on is marked in the drawing; the names are one click away, not a paragraph of links.
          data.now.length > 0 && inProgress,
          h('span', { class: 'switch' }, [['Graph', true], ['List', false]].map(([label, graph]) => h('button', { class: asGraph === graph ? 'on' : '', onclick: () => ((roadmapState.graph = graph), roadmap(rootId)) }, label))),
        ),
        !data.branches.length ? h('div', { class: 'empty' }, 'No features yet.') : asGraph ? graphView({ focus: rootId, defaults: { kind: 'structure', steps: 1 }, extras: { info, edges: through, workOnly: true } }) : h('ul', { class: 'tree top' }, data.branches.map(branch)),
        h('div', { class: 'toolbar', style: 'padding: var(--space-7) var(--space-8); border-top: var(--border-1) solid var(--line)' }, title, h('button', { class: 'primary', onclick: add }, 'Add feature')),
      ),
      data.unplaced.length > 0 &&
        !asGraph &&
        h(
          'section',
          { class: 'card wide' },
          h('header', {}, h('h2', {}, 'Not under any feature'), h('span', { class: 'n' }, data.unplaced.length)),
          h(
            'ul',
            { class: 'rows' },
            data.unplaced.map((w) =>
              h(
                'li',
                { class: `row-top${w.open ? '' : ' finished'}` },
                chip(w.type),
                h('span', { class: 'grow' }, link(w)),
                working(w),
                pill(w.type, w.status),
                features.length > 0 &&
                  h(
                    'select',
                    { title: 'Make this part of a feature', onchange: (e) => e.target.value && change([{ op: 'link', type: 'part_of', from: w.id, to: e.target.value }], 'Placed under a feature in the UI') },
                    h('option', { value: '' }, 'Move to feature…'),
                    features.map((f) => h('option', { value: f.id }, f.title)),
                  ),
              ),
            ),
          ),
        ),
    ),
  );
}
