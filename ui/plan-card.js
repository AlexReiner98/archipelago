// The Workspace screen's Plan card: what the workspace is on, whether a limit is near, the canvas that draws what its
// use is made of (a canvas that names the usage view, which a pack ships), and where its admin manages the
// subscription. All of it is what the server was told by the pack that sold the workspace (its limits); a workspace
// nobody sold has no limit, and no card. Where no pack draws the usage, each limit's use is a row here instead.

import { h, state } from './base.js';
import { canvasAt } from './canvases.js';

/** The canvas a pack ships that draws the usage view, if one does. */
const usageCanvas = () => (state.schema?.canvases ?? []).find((c) => c.props?.view === 'usage');

/** limit: workspace_info's member_limit; use: its use (each limit's use, shown and of what); ended: its ended. */
export function planCard(limit, use, ended) {
  if (!limit && !ended) return null;
  const manage = ended?.manage ?? limit?.manage;
  const says = ended?.manage_says ?? limit?.manage_says;
  const near = (use ?? []).filter((u) => u.near);
  const drawn = usageCanvas();
  return h(
    'section',
    { class: 'card wide' },
    h('header', {}, h('h2', {}, 'Plan')),
    h(
      'ul',
      { class: 'rows' },
      h(
        'li',
        { class: 'one' },
        ended ? h('span', { class: 'pill bad', title: `Ended ${ended.since.slice(0, 10)}` }, 'ended') : h('span', { class: 'pill ok' }, limit.plan ?? 'plan'),
        ended
          ? h('span', { class: 'grow gist', title: `Read-only until it is deleted from the server on ${ended.delete_at.slice(0, 10)}.${ended.note ? ` ${ended.note}` : ''}` }, `read-only · deleted ${ended.delete_at.slice(0, 10)}`)
          : h('span', { class: `grow gist${near.length ? '' : ' muted'}`, title: near.length ? `${near.map((u) => u.name).join(', ')}: ${limit.note ?? 'change the plan for more room'}` : limit.until ? `Runs until ${limit.until.slice(0, 10)}` : 'Within every limit of the plan' }, near.length ? `near the limit: ${near.map((u) => u.name).join(', ')}` : limit.until ? `${limit.days_left} ${limit.days_left === 1 ? 'day' : 'days'} left` : 'within its limits'),
        ended && h('a', { href: '#/workspace?at=backup', title: 'Everything in it, as a file another server can import' }, 'Download backup'),
        !ended && drawn && h('a', { href: canvasAt({ ...drawn, preset: true }), title: 'How much of each limit is used, and what it is made of' }, 'Usage'),
        manage && h('a', { href: manage, target: '_blank', rel: 'noopener noreferrer', title: says ?? 'Change the plan, the seats or the card, or cancel, with the seller' }, says ?? (ended ? 'Subscribe again' : 'Manage subscription')),
      ),
      ...(ended || drawn ? [] : (use ?? []).map((u) =>
        h(
          'li',
          { class: 'one' },
          h('span', { class: 'grow gist muted' }, u.name),
          h('span', { class: `count-of${u.over ? ' bad' : u.near ? ' warn' : ''}`, title: `${u.shown} of ${u.of}${u.over ? ': at the limit' : u.near ? ': near the limit' : ''}` }, h('strong', {}, u.shown), ` of ${u.of}`),
        ),
      )),
    ),
  );
}
