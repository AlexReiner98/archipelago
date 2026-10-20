import { api, h } from './base.js';
import { ago, link, menu, pill, unfolded } from './words.js';

// ---- Proof ---------------------------------------------------------------

// Which questions are unfolded, and which build each page is looking at.
export const proofOpen = new Set();
export const proofBuild = new Map();
// Pictures already fetched, by result and when it was reported.
export const proofPictures = new Map();

/**
 * How we know it is correct, on the page of whatever the questions belong to
 * (a project, a feature, or one question): each question with how many of its
 * tests passed on one build, opening to the tests as pictures. Nothing, where
 * no question has been asked.
 */
export async function proofPart(rootId, withLog = false) {
  const main = document.getElementById('proof');
  if (main?.dataset.root !== rootId) return;
  const data = await api('view', { name: 'proof', params: { of: rootId, build: proofBuild.get(rootId) } });
  if (!main.isConnected) return;
  const { counts } = data;
  const log = withLog ? await api('view', { name: 'changelog', params: { of: rootId } }).catch(() => null) : null;
  if (!main.isConnected) return;
  const shown = log?.features ?? [];
  if (!counts.questions && !shown.length) return main.replaceChildren();
  const bar = (done, total) => h('span', { class: 'progress', title: `${done} of ${total} tests passed` }, h('span', { class: 'bar' }, h('span', { style: `width: ${total ? Math.round((done / total) * 100) : 0}%` })), h('span', { class: 'muted small' }, `${done}/${total}`));
  const mark = (t) => {
    const r = t.result;
    const limit = t.tolerance ? `Must be ${t.tolerance}` : '';
    if (r?.passed) return h('span', { class: 'pill ok', title: limit }, r.value ?? 'passed');
    if (r) return h('span', { class: 'pill bad', title: limit }, r.value ?? 'failed');
    if (t.status === 'draft') return h('span', { class: 'pill closed', title: 'Wanted, not yet written' }, 'not written');
    return h('span', { class: 'pill warn', title: t.before ? `Last run on ${t.before.build}: ${t.before.passed ? 'passed' : 'failed'}` : 'Never run' }, 'not run');
  };
  // A picture kept here is asked for with the page's own token, which an image address cannot carry.
  const kept = (r) => {
    const img = h('img', { alt: '' });
    const key = `${r.id}:${r.at}`;
    if (!proofPictures.has(key)) proofPictures.set(key, api('picture', { result: r.id }).then((p) => (p ? `data:${p.content_type};base64,${p.data}` : '')));
    proofPictures.get(key).then((src) => src && (img.src = src), () => {});
    return img;
  };
  const tile = (t) =>
    h(
      'a',
      { class: 'ptile', href: `#/e/${t.id}`, title: [t.title, t.compares, t.environment].filter(Boolean).join('\n') },
      t.result?.stored ? kept(t.result) : t.result?.picture ? h('span', { class: 'shot muted small', title: `In the repository, not sent here: ${t.result.picture}` }, 'on disk') : h('span', { class: 'shot muted small' }, 'no picture'),
      h('span', { class: 'cap' }, t.title),
      mark(t),
    );
  const question = (q) => {
    const key = `${rootId}:${q.id}`;
    return h(
      'li',
      {},
      h(
        'details',
        { open: proofOpen.has(key), ontoggle: (ev) => (ev.target.open ? proofOpen.add(key) : proofOpen.delete(key)) },
        h(
          'summary',
          {},
          h('span', { class: 'grow', title: q.title }, link(q)),
          q.public && h('span', { class: 'chip', title: 'Anyone can see this question, its tests and their results' }, 'public'),
          q.failed > 0 && h('span', { class: 'pill bad' }, `${q.failed} failed`),
          q.not_run > 0 && h('span', { class: 'pill warn' }, `${q.not_run} not run`),
          q.answered && h('span', { class: 'pill ok' }, 'answered'),
          q.total > 0 ? bar(q.passed, q.total) : h('span', { class: 'muted small nowrap' }, 'no tests'),
        ),
        q.total > 0 && h('div', { class: 'ptiles' }, q.tests.map(tile)),
      ),
    );
  };
  const builds = data.builds.length > 1 ? menu(data.build, data.builds.map((b) => [b, () => (proofBuild.set(rootId, b), proofPart(rootId, withLog))])) : data.build && h('span', { class: 'chip', title: 'The build these results are from' }, data.build);
  main.replaceChildren(
    h(
      'div',
      { class: 'grid proofs', style: 'margin-bottom: var(--space-8)' },
      counts.questions > 0 &&
      h(
        'section',
        { class: 'card wide' },
        h(
          'header',
          { class: 'bar' },
          h('h2', { title: 'What a user would ask before trusting it, and the tests that answer each' }, 'How we know'),
          builds,
          counts.tests > 0 && bar(counts.passed, counts.tests),
          h('span', { class: `pill${counts.answered === counts.questions ? ' ok' : ''}` }, `${counts.answered}/${counts.questions} answered`),
          counts.failed > 0 && h('span', { class: 'pill bad' }, `${counts.failed} failed`),
          data.to_send?.length > 0 && h('span', { class: 'pill warn', title: `Public results whose picture is still only in its repository:\n${data.to_send.map((p) => p.picture).join('\n')}` }, `${data.to_send.length} picture${data.to_send.length === 1 ? '' : 's'} to send`),
        ),
        h('ul', { class: 'tree top' }, data.proofs.map(question)),
      ),
      shown.length > 0 &&
        h(
          'details',
          { class: 'card wide fold', open: unfolded.get(`${rootId}:changelog`) ?? false, ontoggle: (ev) => unfolded.set(`${rootId}:changelog`, ev.target.open) },
          h('summary', {}, h('h2', { title: 'What is built or shipped; what is only planned is not here' }, 'Changelog'), h('span', { class: 'n' }, shown.length)),
          h(
            'ul',
            { class: 'rows' },
            shown.map((f) =>
              h('li', { class: 'row-top' }, h('span', { class: 'grow', title: f.title }, link(f)), f.release && h('a', { class: 'chip', href: `#/e/${f.release.id}`, title: f.release.title }, f.release.version ?? f.release.title), pill(f.type, f.status), ago(f.at)),
            ),
          ),
        ),
    ),
  );
}
