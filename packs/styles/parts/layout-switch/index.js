// The layout up, in the view band (slot bar.layouts), as the styles pack's part (decision e_47pjkbxb): how this pane is
// arranged, kept as its query changes. Its choices are the layouts the packs ship and those kept on the map (the view
// layouts); the first a pack ships is the default. Picking one moves the page to the same query in the layout chosen
// (`go`: the view and what is lit are kept by the page). While the pane is drawn in a layout kept on the map, its menu
// deletes it (styles.delete_layout: archived, it stays in the history), after saying which views draw in it, and the
// pane goes to the default.

import { choicesOf, deletable, layoutOf } from './choices.js';

function marks(input, asking, failed) {
  const address = input?.address;
  const layout = address?.layout ?? {};
  const listed = input?.views?.layouts;
  const { values, names, value, said } = choicesOf(listed, layout);
  const gone = deletable(listed, layout);
  const pick = ['input', { key: 'layout', kind: 'pick', values, names, value, tip: `Layout: ${said}` }];
  if (asking && gone) {
    const using = gone.views ? `${gone.views === 1 ? 'A view draws' : `${gone.views} views draw`} in it and will go to the default. ` : '';
    return ['box', { flow: 'column', gap: 2 },
      ['text', { look: 'body', tip: `${using}It stays in the history.` }, `Delete “${gone.title}”?`],
      ['box', { flow: 'row', gap: 2 }, ['button', { key: 'delete', look: 'main', tone: 'bad' }, 'Delete'], ['button', { key: 'stop', look: 'quiet' }, 'Keep it']],
    ];
  }
  return ['box', { flow: 'row', gap: 2 },
    ['text', { look: 'muted', tip: 'Layout: how this view is arranged' }, 'Layout'],
    pick,
    ...(gone ? [['menu', { key: 'more', label: '⋯', look: 'quiet', tip: 'More' }, ['button', { key: 'ask', tone: 'bad', tip: 'Delete the layout this view is drawn with' }, 'Delete layout']]] : []),
    ...(failed ? [['text', { tone: 'bad', tip: String(failed).slice(0, 200) }, 'Not deleted']] : []),
  ];
}

export default function layoutSwitch(input, tools) {
  let now = input, asking = false, failed;
  const draw = () => marks(now, asking, failed);
  return {
    marks: draw(),
    update(next) {
      now = next;
      return draw();
    },
    async on(event) {
      const query = now?.address?.query ?? null;
      if (event?.name === 'pick' && event.key === 'layout') return void tools.go({ query, layout: layoutOf(event.value) });
      if (event?.name !== 'press') return undefined;
      if (event.key === 'ask') return ((asking = true), (failed = undefined), draw());
      if (event.key === 'stop') return ((asking = false), draw());
      const gone = event.key === 'delete' && deletable(now?.views?.layouts, now?.address?.layout);
      if (!gone) return undefined;
      asking = false;
      const said = await tools.act('styles.delete_layout', { layout: gone.id });
      if (said?.error) return ((failed = said.error), draw());
      tools.go({ query, layout: {} });
      return draw();
    },
  };
}
