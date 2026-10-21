// The Workspace screen's Plan card: what the workspace is on and how many members that allows, with where its admin
// manages the subscription. All of it is what the server was told by the pack that sold the workspace (its member
// limit); a workspace nobody sold has no limit, and no card.

import { h } from './base.js';

/** limit: workspace_info's member_limit; members: how many there are now. */
export function planCard(limit, members) {
  if (!limit) return null;
  const room = `up to ${limit.members} member${limit.members === 1 ? '' : 's'}`;
  return h(
    'section',
    { class: 'card wide' },
    h('header', {}, h('h2', {}, 'Plan')),
    h(
      'div',
      { class: 'row-top', style: 'padding: var(--space-6) var(--space-8)' },
      h('span', { class: 'pill ok' }, limit.plan ?? 'plan'),
      h('span', { class: 'grow gist muted', title: `${members} of ${limit.members} in use` }, room),
      limit.manage && h('a', { href: limit.manage, target: '_blank', rel: 'noopener noreferrer', title: 'Change the plan, the seats or the card, or cancel, with the seller' }, 'Manage subscription'),
    ),
  );
}
