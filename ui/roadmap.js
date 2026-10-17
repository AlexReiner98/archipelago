import { api, ask, h, state, tell } from './base.js';
import { renderBody } from './body.js';
import { graphView } from './graph.js';
import { treeFor } from './screens.js';
import { chip, isClosed, link, menu, pill, statusesOf, types } from './words.js';

// ---- Projects ------------------------------------------------------------

/** Each project's roadmap tree, by project id: the tree a screen draws on it, if one does. `all` is the project list of the `questions` view. */
export async function projectTrees(all) {
  const tree = (pr) => treeFor(pr.type ?? 'project');
  return new Map(await Promise.all(all.map(async (pr) => [pr.id, tree(pr) ? await api('view', { name: 'tree', params: { root: pr.id, tree: tree(pr) } }).catch(() => null) : null])));
}

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
  const title = h('input', { type: 'text', placeholder: 'A new feature', style: 'flex: 1; min-width: 200px' });
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
        h('div', { class: 'toolbar', style: 'padding: 12px 14px; border-top: 1px solid var(--line)' }, title, h('button', { class: 'primary', onclick: add }, 'Add feature')),
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

// ---- Questions -----------------------------------------------------------

export const openQuestions = new Set();
export const listed = (label, items, extra) => items.length > 0 && h('div', { class: 'row-sub' }, `${label}: `, items.map((x, i) => [i > 0 && ', ', link(x), extra?.(x)]));

export function questionItem(q, change, where, plain = false) {
  const closed = types.get(q.type)?.statuses.closed ?? [];
  let answer;
  if (q.kind === 'decision') {
    const outcome = h('input', { type: 'text', placeholder: 'What is decided', style: 'flex: 1; min-width: 220px' });
    const why = h('input', { type: 'text', placeholder: 'Why (optional)', style: 'flex: 1; min-width: 220px' });
    const option = h('input', { type: 'text', placeholder: 'Add an option', class: 'option-new' });
    const picks = h('div', { class: 'toolbar options' });
    const pick = (o, button) => {
      outcome.value = o;
      state.dirty = true; // a choice not yet confirmed must survive a live update
      for (const b of picks.querySelectorAll('button')) b.classList.toggle('on', b === button);
    };
    picks.append(
      ...q.options.map((o) => {
        const button = h('button', { onclick: () => pick(o, button) }, o);
        return button;
      }),
      option,
    );
    option.addEventListener('keydown', (e) => e.key === 'Enter' && option.value.trim() && change([{ op: 'update', id: q.id, props: { options: [...q.options, option.value.trim()] } }], 'Option added in the UI'));
    const decide = () => {
      if (!outcome.value.trim()) return outcome.focus();
      change([{ op: 'update', id: q.id, status: closed[0], props: { outcome: outcome.value.trim(), rationale: why.value.trim() || null, decided_on: new Date().toISOString().slice(0, 10) } }], 'Decided in the UI');
    };
    answer = [picks, h('div', { class: 'toolbar' }, outcome, why, h('button', { class: 'primary', onclick: decide }, 'Decide'))];
  } else {
    answer = h(
      'div',
      { class: 'toolbar' },
      h('span', { class: 'muted' }, 'It turned out to be'),
      closed.map((st) => h('button', { onclick: async () => (await ask({ title: `Mark this ${st}?`, message: q.title, action: `Mark ${st}` })) && change([{ op: 'update', id: q.id, status: st }], `Marked ${st} in the UI`) }, st)),
    );
  }
  // Asking is not deciding: it leaves the question open and makes a task about
  // it, which any agent listening hears at once.
  const wish = h('input', { type: 'text', placeholder: 'Ask an agent to look into something first', style: 'flex: 1; min-width: 220px' });
  const askAgent = () =>
    wish.value.trim() &&
    change(
      [
        { op: 'create', ref: 'ask', type: 'task', title: wish.value.trim(), body: `Asked by the owner on the question "${q.title}". Write what you find into that question's notes or options, then mark this done.` },
        { op: 'link', type: 'about', from: 'ask', to: q.id },
      ],
      'Asked an agent in the UI',
    );
  wish.addEventListener('keydown', (e) => e.key === 'Enter' && askAgent());
  // Folded to one line until it is to be answered. What is unfolded is kept
  // across redraws, which happen on every change to the map.
  // No preview of the notes: a sentence cut in half says nothing. The title is the question; the rest opens.
  const preview = null;
  const more = h(
    'div',
    { class: 'question-more', hidden: !openQuestions.has(q.id) },
    q.body && renderBody(q.body),
    listed('Waiting on this', q.waiting),
    listed('Rests on this', q.assumed_by),
    listed('Being tested by', q.tests, (x) => ` (${x.status})`),
    listed('Evidence', q.evidence, (x) => ` (${x.says})`),
    listed('Asked of an agent', q.asks, (x) => ` (${x.status})`),
    answer,
    h('div', { class: 'toolbar' }, wish, h('button', { onclick: askAgent }, 'Ask an agent')),
  );
  const toggle = h(
    'button',
    {
      onclick: () => {
        more.hidden = !more.hidden;
        if (more.hidden) openQuestions.delete(q.id);
        else openQuestions.add(q.id);
        if (preview) preview.hidden = !more.hidden;
        toggle.textContent = more.hidden ? 'Answer' : 'Close';
      },
    },
    openQuestions.has(q.id) ? 'Close' : 'Answer',
  );
  return h(
    'li',
    { class: 'question' },
    plain
      ? h('div', { class: 'row-top' }, h('span', { class: 'grow' }, link(q)), q.due && h('span', { class: 'pill warn' }, `due ${q.due}`), q.holds_up > 0 && h('span', { class: 'muted small', title: 'How many things wait on this' }, `holds up ${q.holds_up}`), toggle)
      : h('div', { class: 'row-top' }, chip(q.type), h('strong', { class: 'grow' }, link(q)), where, q.due && h('span', { class: 'pill warn' }, `due ${q.due}`), q.holds_up > 0 && h('span', { class: 'pill bad', title: q.waiting.map((w) => w.title).join('\n') }, `holds up ${q.holds_up}`), toggle),
    preview,
    more,
  );
};
