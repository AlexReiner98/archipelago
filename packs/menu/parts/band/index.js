// The view band's own buttons, as the menu pack's part (task e_pe3fjd75, from ui/canvases.js and ui/canvas-menu.js):
// Save what is up, into the view up or, named here, as a new one; and, in its menu, Save as new view and Delete. The
// host draws the button naming the view up and what it opens (bar.views), the panes' buttons and the layout switch
// (bar.layouts); this part is handed the page's address (`go`), which view is up (`piece.current`, `piece.home`) and
// the views kept (the saved_views view, as a person picks), and answers with marks. A name is asked in the band, a
// delete is confirmed there, both as marks: a part has no dialog. What it keeps goes to the map as the person's change
// (menu.save_view, menu.drop_view), and the page then goes to the view as kept, or as it stands unsaved.

import { changedFrom, saveInput, upOf } from './views.js';

const cut = (s, n = 200) => String(s ?? '').slice(0, n);

/** The marks for what it was handed and what the person is in the middle of (`at`: naming, deleting, going out). */
function marks(input, at) {
  const address = input?.address;
  const current = upOf(input);
  const changed = changedFrom(current, address);
  const working = current?.life === 'working' && !current.preset;
  // Home and a page with no query draw no band of their own: there is nothing up to keep.
  if (!address?.query) return ['box', { flow: 'row', gap: 3 }];
  if (at.naming)
    return ['box', { flow: 'row', gap: 3, align: 'center' },
      ['input', { key: 'name', value: at.name, hint: 'A name, a few words', label: 'The view’s name', tip: 'Its name: a few words, 60 characters at most', focus: true }],
      ['button', { key: 'name:save', look: 'main', tip: 'Keep what is up under this name' }, 'Save'],
      ['button', { key: 'name:cancel', look: 'quiet', tip: 'Keep nothing' }, 'Cancel'],
      ...(at.said ? [['text', { tone: 'bad', size: 2, tip: cut(at.said) }, cut(at.said, 80)]] : []),
    ];
  if (at.dropping && current)
    return ['box', { flow: 'row', gap: 3, align: 'center' },
      ['text', { tip: 'It leaves the bar and Home. What is up stays, unsaved.' }, `Delete “${cut(current.title, 40)}”?`],
      ['button', { key: 'drop:yes', tone: 'bad', tip: 'Delete it: it can be used again from its page' }, 'Delete'],
      ['button', { key: 'drop:no', look: 'quiet', tip: 'Keep it' }, 'Cancel'],
      ...(at.said ? [['text', { tone: 'bad', size: 2, tip: cut(at.said) }, cut(at.said, 80)]] : []),
    ];
  const save = at.going
    ? ['text', { look: 'muted', tip: 'Going out' }, 'Saving…']
    : current && !changed && !current.preset && !working
      ? ['text', { look: 'muted', tip: `“${cut(current.title)}” is kept` }, 'Saved']
      : ['button', { key: 'save', look: 'quiet', tip: current ? (changed ? `Save the changes to “${cut(current.title)}”` : working ? `Keep “${cut(current.title)}”: an agent’s view, retired with what it is about until you keep it` : `Save “${cut(current.title)}” as yours`) : 'Save this view' }, changed ? 'Save •' : working ? 'Keep' : 'Save'];
  const rare = [
    current && ['button', { key: 'new', tip: 'Keep what is up as a view of its own' }, 'Save as new view'],
    current && !current.preset && ['button', { key: 'drop', tone: 'bad', tip: `Delete “${cut(current.title)}”` }, 'Delete this view'],
  ].filter(Boolean);
  return ['box', { flow: 'row', gap: 3, align: 'center' },
    save,
    ...(at.said ? [['text', { tone: 'bad', size: 2, tip: cut(at.said) }, cut(at.said, 80)]] : []),
    ...(rare.length ? [['menu', { key: 'more', label: '▾', look: 'quiet', tip: 'More for the saved view' }, ...rare]] : []),
  ];
}

export default function band(input, tools) {
  let now = input;
  const at = { naming: false, name: '', dropping: false, going: false, said: '' };
  const draw = () => marks(now, at);
  const reset = () => Object.assign(at, { naming: false, name: '', dropping: false, said: '' });

  /** Send the action, then go where the page should stand: the view as kept, or what is up unsaved. */
  async function send(action, params, then) {
    at.going = true;
    at.said = '';
    tools.marks(draw());
    const made = await tools.act(action, params);
    at.going = false;
    if (made?.error) return ((at.said = String(made.error)), draw());
    reset();
    if (made?.proposal) return ((at.said = 'Held for the owner'), draw());
    const go = then(made);
    if (go) tools.go(go);
    return draw();
  }

  const keep = (title, into) => {
    const params = saveInput(now, title, into);
    if (!params) return ((at.said = 'Nothing is up to keep'), draw());
    return send('menu.save_view', params, (made) => {
      const id = params.id ?? made?.created?.view;
      return id && { query: now.address.query, layout: { ...now.address.layout, canvas: id } };
    });
  };

  return {
    marks: draw(),
    update(next) {
      now = next;
      return draw();
    },
    async on(event) {
      if (at.going) return undefined;
      if (event?.key === 'name' && (event.name === 'edit' || event.name === 'submit')) {
        at.name = cut(event.value, 200);
        if (event.name === 'edit') return undefined;
      } else if (event?.name !== 'press') return undefined;
      const current = upOf(now);
      const views = now?.views?.saved_views?.pictures ?? [];
      switch (event.name === 'submit' ? 'name:save' : event.key) {
        case 'save':
          // Into the view up, at once; with none up, a name is asked first.
          if (current && !current.preset) return keep(current.title, current);
          if (current?.preset) return keep(current.title, null);
          return ((at.naming = true), draw());
        case 'new':
          return ((at.naming = true), (at.name = ''), draw());
        case 'name:save': {
          const title = at.name.trim();
          if (!title) return ((at.said = 'A view needs a name.'), draw());
          if (title.length > 60) return ((at.said = 'A name is a few words: 60 characters at most.'), draw());
          // A name a kept view has already is that view, saved into.
          const same = views.find((c) => !c.preset && String(c.title).toLowerCase() === title.toLowerCase());
          return keep(title, same ?? null);
        }
        case 'name:cancel':
        case 'drop:no':
          return (reset(), draw());
        case 'drop':
          return ((at.dropping = true), draw());
        case 'drop:yes':
          if (!current || current.preset) return (reset(), draw());
          return send('menu.drop_view', { id: current.lens }, () => {
            const { canvas: _c, ...layout } = now.address.layout ?? {};
            return { query: now.address.query, layout: { ...layout, canvas: null } };
          });
        default:
          return undefined;
      }
    },
  };
}
