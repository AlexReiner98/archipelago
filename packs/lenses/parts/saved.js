// The views kept on the map, one line each, opening in one press, as the lenses pack's part (task e_x8b2d8yb): what a
// screen's `saved_views` piece shows. The kept, newest first; agents' working views folded under them; what the packs
// ship folded last. Each row its thumbnail, its name, what its query finds and, for the view the canvas draws now
// (`up`, the host's), a mark. It is handed the `saved_views` view as a person picks (pack.json) and answers with marks.

import { AGENTS_TIP, fold, lensWords, newest, pickable, viewsIn, working } from './views.js';

const cut = (s) => String(s).slice(0, 200);

function row(c, input) {
  const words = lensWords(c, input?.words);
  return ['box', { flow: 'row', gap: 5, key: `v:${c.lens}`, view: c.lens, tip: cut(c.note ? `${c.title}: ${c.note}` : c.title) },
    ['thumb', { view: c.lens }],
    ['box', { grow: true }, ['text', {}, c.title]],
    ...(words ? [['text', { look: 'muted', size: 2, tip: cut(words) }, words]] : []),
    ...(c.cannot ? [['text', { look: 'muted', size: 2, tip: cut(`It cannot draw here: ${c.cannot}`) }, 'cannot draw']] : []),
    ...(c.lens === input?.up ? [['text', { look: 'mark', tone: 'ok', tip: 'The view up now' }, 'up']] : []),
  ];
}

function marks(input, open) {
  const title = String(input?.piece?.title ?? 'Views').slice(0, 80);
  if (!input?.views?.saved_views) return ['box', { flow: 'column', gap: 4 }, ['text', { look: 'title' }, title], ['text', { tone: 'bad' }, 'Could not read the views']];
  const listed = pickable(viewsIn(input), input?.up);
  const kept = listed.filter((c) => !c.preset && !working(c)).sort(newest);
  const folded = (key, name, views, tip) => {
    if (!views.length) return [];
    const shown = open.has(key) || views.some((c) => c.lens === input?.up);
    return [fold(key, name, views.length, shown, tip), ...(shown ? [['list', { look: 'rows' }, ...views.map((c) => row(c, input))]] : [])];
  };
  return ['box', { flow: 'column', gap: 4 },
    ['text', { look: 'title' }, title],
    kept.length ? ['list', { look: 'rows' }, ...kept.map((c) => row(c, input))] : ['text', { look: 'muted', tip: 'Save in the bar keeps what is up as a view' }, 'None saved yet.'],
    ...folded('agents', 'Agents’', listed.filter(working).sort(newest), AGENTS_TIP),
    ...folded('packs', 'From packs', listed.filter((c) => c.preset), 'Views the packs ship: Save one under its own name to keep your version'),
  ];
}

export default function saved(input) {
  let now = input;
  const open = new Set();
  const draw = () => marks(now, open);
  return {
    marks: draw(),
    update(next) {
      now = next;
      return draw();
    },
    on(event) {
      if (event?.name !== 'press' || !['agents', 'packs'].includes(event.key)) return undefined;
      if (open.has(event.key)) open.delete(event.key);
      else open.add(event.key);
      return draw();
    },
  };
}
