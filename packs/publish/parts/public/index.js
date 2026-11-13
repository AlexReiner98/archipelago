// A product's public page, as the publish pack's part (task e_atxefw2s): how we know it is correct (the questions a
// user would ask before trusting it, each with the tests that answer it) and what has been built. It fills the host's
// page.public, is handed the page's data (`page`, packs/publish/kernel/public.ts's publicPage), and answers with marks
// alone: a test's picture is the host's to draw, out of the data it handed. Picking another build is the page's: the
// host reads that build's data, with its marks. Run on the server as the page is read (`at.frozen`,
// packs/publish/kernel/page-marks.ts), every question is open, since marks kept for a reader do not fold.

const day = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { dateStyle: 'medium' });
};
const tip = (said) => String(said ?? '').slice(0, 200);

/** How many of how many, as a mark: the words, with the share in its tip. */
const count = (done, total, what) => ['text', { look: 'muted', tip: `${done} of ${total} ${what}` }, `${done}/${total}`];

/** A test's mark: its result, or that it waits to be written or run. */
export function testMark(t) {
  const limit = t.tolerance ? `Must be ${t.tolerance}` : undefined;
  if (t.result?.passed) return ['text', { look: 'mark', tone: 'ok', ...(limit && { tip: tip(limit) }) }, String(t.result.value ?? 'passed')];
  if (t.result) return ['text', { look: 'mark', tone: 'bad', ...(limit && { tip: tip(limit) }) }, String(t.result.value ?? 'failed')];
  if (!t.written) return ['text', { look: 'mark', tip: 'Wanted, not yet written' }, 'not written'];
  return ['text', { look: 'mark', tone: 'warn', tip: t.before ? `Last run on ${t.before.build}: ${t.before.passed ? 'passed' : 'failed'}` : 'Never run' }, 'not run'];
}

/** One test as a tile: its picture, its name and its mark. */
const tile = (t, i) => [
  'box',
  { key: `t:${i}`, flow: 'column', gap: 2, tip: tip([t.title, t.compares, t.environment].filter(Boolean).join('\n')) },
  /^e_[a-z0-9]{8}$/.test(t.result?.picture ?? '') ? ['picture', { item: t.result.picture }] : ['text', { look: 'muted', size: 2 }, 'no image'],
  ['text', { size: 2 }, String(t.title ?? '')],
  testMark(t),
];

/** A question as a fold: its title and its marks, and, open, the tiles of its tests. */
function question(q, open) {
  const marks = [
    ...(q.failed > 0 ? [['text', { look: 'mark', tone: 'bad' }, `${q.failed} failed`]] : []),
    ...(q.not_run > 0 ? [['text', { look: 'mark', tone: 'warn' }, `${q.not_run} not run`]] : []),
    ...(q.answered ? [['text', { look: 'mark', tone: 'ok' }, 'answered']] : []),
    q.total > 0 ? count(q.passed, q.total, 'tests passed') : ['text', { look: 'muted', size: 2 }, 'no tests yet'],
  ];
  return [
    'box',
    { key: `q:${q.id}`, flow: 'column', gap: 3 },
    ['box', { flow: 'row', gap: 4, align: 'between' }, ['button', { key: `open:${q.id}`, look: 'quiet', tip: tip(q.title) }, `${open ? '▾' : '▸'} ${q.title}`], ['box', { flow: 'row', gap: 4 }, ...marks]],
    ...(open && q.total > 0 ? [['box', { flow: 'row', gap: 4, wrap: true }, ...(q.tests ?? []).map(tile)]] : []),
  ];
}

/** The page as marks; `open` holds the questions unfolded. */
export function marks(d, open = new Set()) {
  if (!d || !Array.isArray(d.questions)) return ['text', { look: 'muted' }, 'There is nothing public at this address.'];
  const c = d.counts ?? {};
  const builds = Array.isArray(d.builds) ? d.builds : [];
  const pick = builds.length > 1 ? [['input', { key: 'build', kind: 'pick', values: builds.map(String), value: String(d.build ?? ''), tip: 'The build these results are from' }]] : d.build ? [['text', { look: 'mark', tip: 'The build these results are from' }, String(d.build)]] : [];
  const changelog = Array.isArray(d.changelog) ? d.changelog : [];
  return [
    'box',
    { key: 'page', flow: 'column', gap: 8 },
    ['box', { key: 'head', flow: 'row', gap: 6, align: 'between' }, ['text', { look: 'title', size: 8 }, String(d.title ?? '')], ...pick],
    ...(d.questions.length
      ? [
          [
            'box',
            { key: 'know', look: 'band', pad: 6, flow: 'column', gap: 4 },
            [
              'box',
              { flow: 'row', gap: 4, align: 'between' },
              ['text', { look: 'title', size: 6, tip: 'What a user would ask before trusting it, and the tests that answer each' }, 'How we know'],
              [
                'box',
                { flow: 'row', gap: 4 },
                ...(c.failed > 0 ? [['text', { look: 'mark', tone: 'bad' }, `${c.failed} failed`]] : []),
                ['text', { look: 'mark', ...(c.answered === c.questions && { tone: 'ok' }) }, `${c.answered ?? 0}/${c.questions ?? 0} answered`],
                ...(c.tests > 0 ? [count(c.passed, c.tests, 'tests passed')] : []),
              ],
            ],
            ...d.questions.map((q) => question(q, open.has(q.id))),
          ],
        ]
      : []),
    ...(changelog.length
      ? [
          [
            'box',
            { key: 'log', look: 'band', pad: 6, flow: 'column', gap: 4 },
            ['text', { look: 'title', size: 6, tip: 'What has been built and shipped' }, 'Changelog'],
            [
              'list',
              { look: 'rows' },
              ...changelog.map((f, i) => [
                'box',
                { key: `f:${i}`, flow: 'row', gap: 4, align: 'between' },
                ['text', { tip: tip(f.title) }, String(f.title ?? '')],
                ['box', { flow: 'row', gap: 4 }, ...(f.release ? [['text', { look: 'mark', tip: tip(f.release.title) }, String(f.release.version ?? f.release.title)]] : []), ['text', { look: 'mark', ...(f.status === 'shipped' && { tone: 'ok' }) }, String(f.status ?? '')], ['text', { look: 'muted', size: 2 }, day(f.at)]],
              ]),
            ],
          ],
        ]
      : []),
    ...(!d.questions.length && !changelog.length ? [['text', { look: 'muted' }, 'Nothing is public here yet.']] : []),
    ['text', { key: 'foot', look: 'muted', size: 2, tip: 'Each result is reported by the test itself when it runs; nothing here is written by hand' }, 'Read live from the record of the work.'],
  ];
}

export default function publicPage(input) {
  let d = input?.page ?? input?.views?.page ?? null;
  const open = new Set(input?.at?.frozen ? (d?.questions ?? []).map((q) => q.id) : []);
  return {
    marks: marks(d, open),
    title: d?.title ? `${d.title}: how we know` : 'How we know',
    update(next) {
      d = next?.page ?? next?.views?.page ?? null;
      return marks(d, open);
    },
    on(event) {
      const id = event?.name === 'press' && /^open:(.+)$/.exec(event.key ?? '')?.[1];
      if (id) return (open.has(id) ? open.delete(id) : open.add(id), marks(d, open));
      return undefined;
    },
  };
}
