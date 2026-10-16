// Home, and the projects at the top of Search.

import { api, h, part, tell } from './base.js';
import { progressBar, projectTrees, questionItem } from './roadmap.js';
import { chip, entityRow, link, pill, refreshReviewCount } from './words.js';

// ---- Projects, at the top of Search ----------------------------------------

// The projects, one to a row: where each stands and how much of it is
// waiting for the owner, which is dealt with on its own page.
export let todayOpen = '';

export async function projects(main) {
  const here = () => main.isConnected;
  if (!main.childElementCount) main.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  const view = (name, params) => api('view', { name, params });
  const [info, asked, needs, blockers, risk] = await Promise.all([
    api('workspace_info'),
    view('questions'),
    view('needs_me'),
    view('blockers'),
    view('at_risk'),
  ]);
  const trees = await projectTrees(asked.projects);
  if (!here()) return;

  // Which project a thing belongs to: the project itself and everything in its tree.
  const home = new Map();
  for (const pr of asked.projects) {
    const walk = (b) => {
      home.set(b.id, pr.id);
      for (const w of b.work ?? []) home.set(w.id, pr.id);
      for (const inner of b.branches ?? []) walk(inner);
    };
    home.set(pr.id, pr.id);
    for (const b of trees.get(pr.id)?.branches ?? []) walk(b);
    for (const w of trees.get(pr.id)?.unplaced ?? []) home.set(w.id, pr.id);
  }
  // A project's three numbers: questions open in it (an answer an agent has
  // offered is still one to decide), work that is the owner's, and what is blocked.
  const inProject = (id, items, of = (e) => e.id) => items.filter((x) => home.get(of(x)) === id).length;
  const counts = (pr) => ({ decide: pr.questions, todo: inProject(pr.id, needs.actionable), blocked: inProject(pr.id, blockers, (b) => b.entity.id) });
  const weight = (pr) => (pr.status === 'active' ? 1000 : 0) + pr.questions + inProject(pr.id, needs.actionable);
  const ordered = [...asked.projects].sort((a, b) => weight(b) - weight(a));

  const projectRow = (pr) => {
    const tree = trees.get(pr.id);
    const c = counts(pr);
    // A number that is nought keeps its place, so the columns line up down the list.
    const count = (n, label, cls, title) => h('span', { class: `count-of ${n ? cls : 'none'}`, title }, n > 0 && [h('strong', {}, n), ` ${label}`]);
    return h(
      'li',
      {},
      h(
        'a',
        { class: `project-row${pr.status !== 'active' ? ' resting' : ''}`, href: `#/e/${pr.id}`, title: pr.title },
        h('strong', { class: 'grow' }, pr.title),
        pr.status !== 'active' && pill(pr.type, pr.status),
        count(c.decide, 'decide', 'warn', 'Questions open in it'),
        count(c.todo, 'do', '', 'Yours to do, with nothing in the way'),
        count(c.blocked, 'blocked', 'bad', 'Blocked work in it'),
        tree?.progress.total ? progressBar(tree.progress) : h('span', { class: 'progress muted small' }, 'no tasks'),
      ),
    );
  };
  const inbox = [
    !info.owner && h('p', { class: 'error' }, 'This workspace has no owner yet, so there is nobody for this page to be about. ', h('a', { href: '#/workspace' }, 'Set the owner'), '.'),
    ordered.length ? h('section', { class: 'card' }, h('ul', { class: 'rows projects' }, ordered.map(projectRow))) : h('div', { class: 'empty' }, 'No projects yet.'),
  ].filter(Boolean);
  // What there is to read, from anywhere, behind a count at the top of the page.
  // What is about to go wrong, anywhere: a count when there is any, and the list behind it on a click.
  const others = {
    risk: {
      label: 'At risk',
      n: risk.due_soon_or_overdue.length + risk.resting_on_refuted_hypothesis.length,
      list: () => [
        ...risk.due_soon_or_overdue.map((e) => entityRow(e, [e.overdue ? 'Overdue' : `Due within ${risk.due_within_days} days`, e.blocked && ', and blocked'])),
        ...risk.resting_on_refuted_hypothesis.map((e) => entityRow(e, ['rests on a refuted hypothesis: ', h('a', { href: `#/e/${e.hypothesis}` }, e.hypothesis_title)])),
      ],
    },
  };
  if (todayOpen && !others[todayOpen]) todayOpen = '';
  const drawer = h('div', { class: 'drawer' });
  const openDrawer = () => {
    const o = others[todayOpen];
    if (!o) return drawer.replaceChildren();
    const list = o.list();
    drawer.replaceChildren(h('section', { class: 'card' }, list.length ? h('ul', { class: 'rows' }, list) : h('div', { class: 'empty' }, 'Nothing.')));
  };
  const strip = h(
    'div',
    { class: 'switch strip' },
    Object.entries(others).map(([key, o]) =>
      h(
        'button',
        {
          class: todayOpen === key ? 'on' : '',
          disabled: o.n === 0,
          onclick: () => {
            todayOpen = todayOpen === key ? '' : key;
            for (const b of strip.children) b.classList.toggle('on', b.dataset.key === todayOpen);
            openDrawer();
          },
          'data-key': key,
        },
        o.label,
        o.n != null && [' ', h('span', { class: o.warn ? 'warning' : 'muted' }, o.n)],
      ),
    ),
  );
  main.replaceChildren(
    h('div', { class: 'inbox' }, inbox),
    Object.values(others).some((o) => o.n > 0) ? strip : '',
    drawer,
  );
  openDrawer();
}

// ---- Home ----------------------------------------------------------------

// What the app opens on: each project, its open questions, answered where they
// stand, and where it is against its next release. Two things and no more;
// everything else is a click away on the item's own page.
export async function home() {
  const main = part('home');
  if (!main.childElementCount) main.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  const data = await api('view', { name: 'home' });
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      home();
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  const confirm = async (offer, yes) => {
    try {
      await api('decide', { proposal: offer.proposal, approve: yes });
    } catch (err) {
      await tell('That was not done', err.message);
    }
    home();
    refreshReviewCount();
  };
  // A question opens to be answered where it stands: its name does what Answer does, and its page is one link inside.
  const answerable = (q) => {
    const li = questionItem(q, change, null, true);
    const name = li.querySelector('.row-top a');
    const toggle = li.querySelector('.row-top button');
    name?.addEventListener('click', (ev) => (ev.preventDefault(), toggle?.click()));
    li.querySelector('.question-more')?.append(h('div', { class: 'toolbar' }, h('a', { href: `#/e/${q.id}` }, 'Open its page')));
    return li;
  };
  const questionsOf = (p) => {
    const offered = new Set(p.offered.map((o) => o.id));
    const rows = [
      // An agent's answer waits for a yes: the question and what it proposes, on one line.
      ...p.offered.map((o) => h('li', {}, h('div', { class: 'row-top' }, h('span', { class: 'grow', title: o.reason }, link(o), ' ', h('span', { class: 'arrow' }, '→'), ' ', h('strong', {}, o.answer)), h('button', { class: 'primary', onclick: () => confirm(o, true) }, 'Confirm'), h('button', { onclick: () => confirm(o, false) }, 'No')))),
      ...p.questions.filter((q) => !offered.has(q.id)).map((q) => answerable(q)),
    ];
    return h('div', { class: 'home-half' }, h('h3', {}, 'Questions', rows.length > 0 && h('span', { class: 'n' }, rows.length)), rows.length ? h('ul', { class: 'rows' }, rows) : h('div', { class: 'muted small' }, 'None open.'));
  };
  const releaseOf = (p) => {
    const r = p.release;
    if (!r) return h('div', { class: 'home-half' }, h('h3', {}, 'Next release'), h('div', { class: 'muted small' }, 'None set.'));
    return h(
      'div',
      { class: 'home-half' },
      h('h3', { class: 'row-top' }, h('span', { class: 'grow', title: r.title }, link(r)), r.at && h('span', { class: 'pill' }, r.at)),
      h(
        'div',
        { class: 'toolbar home-marks' },
        progressBar({ done: r.done, total: r.total }),
        r.yours > 0 && h('span', { class: 'pill warn', title: 'Waiting on you to answer, act or decide' }, `${r.yours} yours`),
        r.blocked > 0 && h('span', { class: 'pill bad', title: 'Waiting on something else first' }, `${r.blocked} blocked`),
        r.done === r.total && r.to_sort === 0 && h('span', { class: 'pill ok' }, 'ready'),
      ),
      r.still.length > 0 &&
        h(
          'ul',
          { class: 'rows' },
          r.still.map((i) => h('li', { class: 'row-top tie-row' }, chip(i.type), h('span', { class: 'grow', title: i.waiting_on.length ? `Waits on: ${i.waiting_on.join('; ')}` : i.title }, link(i)), i.yours ? h('span', { class: 'pill warn' }, 'yours') : i.blocked && h('span', { class: 'pill bad' }, 'blocked'))),
          r.total - r.done > r.still.length && h('li', { class: 'more' }, h('a', { href: `#/e/${r.id}` }, `${r.total - r.done - r.still.length} more`)),
        ),
    );
  };
  main.replaceChildren(
    ...(data.projects.length
      ? data.projects.map((p) => h('section', { class: 'card home-project' }, h('header', { class: 'bar' }, h('h2', {}, link(p))), h('div', { class: 'home-cols' }, questionsOf(p), releaseOf(p))))
      : [h('div', { class: 'empty' }, 'No projects yet.')]),
  );
}
