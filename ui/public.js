// The public page of one product: how we know it is correct, and what has been built. No login, no framework,
// and nothing drawn that the server did not say: every text is set as text, never as markup.

const main = document.getElementById('main');
const here = location.pathname.replace(/\/+$/, '');

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value == null) continue;
    if (key.startsWith('on')) el[key] = value;
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== false && kid != null && kid !== '') el.append(kid.nodeType ? kid : String(kid));
  return el;
}

const day = (ts) => new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' });
const bar = (done, total, what) => h('span', { class: 'bar', title: `${done} of ${total} ${what}` }, h('span', { style: `width: ${total ? Math.round((done / total) * 100) : 0}%` }));

function mark(t) {
  const limit = t.tolerance ? `Must be ${t.tolerance}` : null;
  if (t.result?.passed) return h('span', { class: 'pill ok', title: limit }, t.result.value ?? 'passed');
  if (t.result) return h('span', { class: 'pill bad', title: limit }, t.result.value ?? 'failed');
  if (!t.written) return h('span', { class: 'pill', title: 'Wanted, not yet written' }, 'not written');
  return h('span', { class: 'pill warn', title: t.before ? `Last run on ${t.before.build}: ${t.before.passed ? 'passed' : 'failed'}` : 'Never run' }, 'not run');
}

const open = new Set();

function draw(d) {
  document.title = `${d.title}: how we know`;
  const pick =
    d.builds.length > 1
      ? h('select', { title: 'The build these results are from', onchange: (ev) => load(ev.target.value) }, d.builds.map((b) => h('option', { value: b, selected: b === d.build }, b)))
      : d.build && h('span', { class: 'pill', title: 'The build these results are from' }, d.build);
  const question = (q) =>
    h(
      'details',
      { open: open.has(q.id), ontoggle: (ev) => (ev.target.open ? open.add(q.id) : open.delete(q.id)) },
      h(
        'summary',
        {},
        h('span', { class: 'grow', title: q.title }, q.title),
        q.failed > 0 && h('span', { class: 'pill bad' }, `${q.failed} failed`),
        q.not_run > 0 && h('span', { class: 'pill warn' }, `${q.not_run} not run`),
        q.answered && h('span', { class: 'pill ok' }, 'answered'),
        q.total > 0 ? [bar(q.passed, q.total, 'tests passed'), h('span', { class: 'muted small' }, `${q.passed}/${q.total}`)] : h('span', { class: 'muted small' }, 'no tests yet'),
      ),
      q.total > 0 &&
        h(
          'div',
          { class: 'tiles' },
          q.tests.map((t) =>
            h(
              'div',
              { class: 'tile', title: [t.title, t.compares, t.environment].filter(Boolean).join('\n') },
              t.result?.picture ? h('img', { src: `${here}/picture/${t.result.picture}`, alt: t.title, loading: 'lazy' }) : h('span', { class: 'shot muted small' }, 'no image'),
              h('span', { class: 'cap' }, t.title),
              mark(t),
            ),
          ),
        ),
    );
  // Through h, which leaves out what is not there: replaceChildren alone would print a false.
  const page = h(
    'div',
    {},
    h('div', { class: 'head' }, h('h1', {}, d.title), h('span', { style: 'flex: 1' }), pick),
    d.questions.length > 0 &&
      h(
        'section',
        { class: 'card' },
        h(
          'header',
          {},
          h('h2', { class: 'grow', title: 'What a user would ask before trusting it, and the tests that answer each' }, 'How we know'),
          d.counts.failed > 0 && h('span', { class: 'pill bad' }, `${d.counts.failed} failed`),
          h('span', { class: `pill${d.counts.answered === d.counts.questions ? ' ok' : ''}` }, `${d.counts.answered}/${d.counts.questions} answered`),
          d.counts.tests > 0 && [bar(d.counts.passed, d.counts.tests, 'tests passed'), h('span', { class: 'muted small' }, `${d.counts.passed}/${d.counts.tests}`)],
        ),
        d.questions.map(question),
      ),
    d.changelog.length > 0 &&
      h(
        'section',
        { class: 'card' },
        h('header', {}, h('h2', { class: 'grow', title: 'What has been built and shipped' }, 'Changelog')),
        d.changelog.map((f) => h('div', { class: 'row' }, h('span', { class: 'grow', title: f.title }, f.title), f.release && h('span', { class: 'pill', title: f.release.title }, f.release.version ?? f.release.title), h('span', { class: `pill${f.status === 'shipped' ? ' ok' : ''}` }, f.status), h('span', { class: 'muted small' }, day(f.at)))),
      ),
    !d.questions.length && !d.changelog.length && h('p', { class: 'muted' }, 'Nothing is public here yet.'),
    h('footer', { class: 'muted small', title: 'Each result is reported by the test itself when it runs; nothing here is written by hand' }, 'Read live from the record of the work.'),
  );
  main.replaceChildren(...page.childNodes);
}

/** The page's colours and lengths: the workspace's style, light or dark as the reader's system is. Only plain hex colours and lengths. */
const dark = matchMedia('(prefers-color-scheme: dark)');
const LENGTH = /^\d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?( \d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?)*$/;
const asLength = (v) => (typeof v === 'number' && v >= 0 ? `${v}px` : typeof v === 'string' && LENGTH.test(v) ? v : null);
let look = {};
const paint = () => {
  const set = (name, value) => /^[a-z][a-z0-9_]*$/.test(name) && document.documentElement.style.setProperty(`--${name.replaceAll('_', '-')}`, value);
  for (const [name, colour] of Object.entries(look.theme?.[dark.matches ? 'dark' : 'light'] ?? {})) if (/^#[0-9a-f]{3,8}$/i.test(String(colour))) set(name, colour);
  for (const [name, value] of Object.entries(look.lengths ?? {})) if (asLength(value)) set(name, asLength(value));
};
dark.addEventListener('change', paint);

async function load(build) {
  try {
    const res = await fetch(`${here}/data${build ? `?build=${encodeURIComponent(build)}` : ''}`);
    if (!res.ok) return main.replaceChildren(h('p', { class: 'muted' }, 'There is nothing public at this address.'));
    const page = await res.json();
    look = page;
    paint();
    draw(page);
  } catch {
    main.replaceChildren(h('p', { class: 'muted' }, 'This page could not be loaded. Try again in a moment.'));
  }
}

load();
