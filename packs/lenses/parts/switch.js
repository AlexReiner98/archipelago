// What the bar's view button opens, as the lenses pack's part (task e_x8b2d8yb): a field to find a view by its name or
// note, then one list (the owner, 9 Nov 2026: no scopes). Home, then the views kept, newest first, each its thumbnail,
// name and age (its note in the tip); agents' working views folded at the end. What the packs ship is found by its
// name, not listed. The bar spans islands, so the host draws this at the map's version (decision e_5b32vdsg). Its piece
// says which view is up (`current`) and whether that is Home (`home`); a row names its view, and the host opens it.

import { AGENTS_TIP, age, fold, newest, pickable, viewsIn, working } from './views.js';

const cut = (s) => String(s).slice(0, 200);

function row(c, current) {
  const when = c.updated_at ? age(c.updated_at) : null;
  const said = c.cannot ? [['text', { look: 'muted', size: 2, tip: cut(`It cannot draw here: ${c.cannot}`) }, 'cannot draw']] : when ? [['text', { look: 'muted', size: 2, tip: when.tip }, when.text]] : [];
  return ['box', { flow: 'row', gap: 5, pad: 3, key: `v:${c.lens}`, view: c.lens, tip: cut(c.note ? `${c.title}: ${c.note}` : c.title), ...(c.lens === current && { tone: 'accent' }) },
    ['thumb', { view: c.lens }],
    ['box', { grow: true }, ['text', {}, c.title]],
    ...said,
  ];
}

function marks(input, find, open) {
  const piece = input?.piece ?? {};
  const current = typeof piece.current === 'string' ? piece.current : undefined;
  const words = find.trim().toLowerCase();
  // Found by words, every view is a choice; else what a pack ships is left to be found, unless it is up.
  const shown = pickable(viewsIn(input), current).filter((c) => (words ? `${c.title} ${c.note ?? ''}`.toLowerCase().includes(words) : !c.preset || c.lens === current));
  const agents = shown.filter(working).sort(newest);
  const rest = shown.filter((c) => !working(c)).sort(newest);
  const agentsOpen = open || Boolean(words) || !rest.length || agents.some((c) => c.lens === current);
  const home = ['box', { flow: 'row', gap: 5, pad: 3, key: 'v:home', view: 'home', tip: 'Home: the views kept', ...(piece.home === true && !current && { tone: 'accent' }) }, ['text', {}, 'Home']];
  return ['box', { flow: 'column', gap: 3 },
    ['input', { key: 'find', value: find, hint: 'Find a view', label: 'Find a view', tip: 'Find a view by its name or its note, those the packs ship among them' }],
    ['list', {},
      ...(words ? [] : [home]),
      ...rest.map((c) => row(c, current)),
      ...(agents.length ? [fold('agents', 'Agents’', agents.length, agentsOpen, AGENTS_TIP), ...(agentsOpen ? agents.map((c) => row(c, current)) : [])] : []),
      ...(shown.length ? [] : [['text', { look: 'muted', size: 2 }, words ? 'No view by that name.' : 'None kept yet.']]),
      ...(input?.views?.saved_views ? [] : [['text', { tone: 'bad' }, 'Could not read the views']]),
    ],
  ];
}

export default function views(input) {
  let now = input, find = '', open = false;
  const draw = () => marks(now, find, open);
  return {
    marks: draw(),
    update(next) {
      now = next;
      return draw();
    },
    on(event) {
      if (event?.key === 'find' && (event.name === 'edit' || event.name === 'submit')) find = String(event.value ?? '').slice(0, 200);
      else if (event?.key === 'agents' && event.name === 'press') open = !open;
      else return undefined;
      return draw();
    },
  };
}
