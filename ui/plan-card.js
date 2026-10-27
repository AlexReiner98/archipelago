// The Workspace screen's Plan card: what the workspace is on and how many members that allows, with where its admin
// manages the subscription. All of it is what the server was told by the pack that sold the workspace (its member
// limit); a workspace nobody sold has no limit, and no card.

import { h } from './base.js';

/** limit: workspace_info's member_limit; members: how many there are now; ended: workspace_info's ended. */
export function planCard(limit, members, ended) {
  if (!limit && !ended) return null;
  const room = limit ? `up to ${limit.members} member${limit.members === 1 ? '' : 's'}` : '';
  const manage = ended?.manage ?? limit?.manage;
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
        : h('span', { class: 'grow gist muted', title: `${members} of ${limit.members} in use` }, room),
      ended && h('a', { href: '#/workspace?at=backup', title: 'Everything in it, as a file another server can import' }, 'Download backup'),
      manage && h('a', { href: manage, target: '_blank', rel: 'noopener noreferrer', title: 'Change the plan, the seats or the card, or cancel, with the seller' }, ended ? 'Subscribe again' : 'Manage subscription'),
      ),
    ),
  );
}
