// Start here: what a new workspace's admin does in its first minutes, one row a step, each ticked once it is done:
// connect a model account, connect GitHub, connect an agent, invite the team. It goes once every
// step is done, or once the admin hides it in this browser. Only an admin sees it, on a server where people sign in.

import { api, authHeaders, h } from './base.js';

const HIDDEN = 'pelago-start-hidden';
const hidden = (ws) => {
  try {
    return localStorage.getItem(HIDDEN) === ws;
  } catch {
    return false;
  }
};

/** The piece: drawn into host. */
export async function startPiece(host, title) {
  const me = await fetch('/whoami', { headers: authHeaders() }).then((r) => r.json()).catch(() => null);
  if (me?.auth !== 'tokens' || !me.actor?.admin || hidden(me.workspace.id)) return host.remove();
  const [model, offered, tokens, members, info] = await Promise.all([api('model_account').catch(() => null), api('connections').catch(() => ({ packs: [] })), api('token_list').catch(() => []), api('member_list').catch(() => []), api('workspace_info').catch(() => ({}))]);
  const room = info.member_limit?.members;
  const steps = [
    { id: 'model', title: 'Connect your AI account', done: model?.runs_on === 'workspace', href: '#/workspace?at=model', tip: 'Anthropic, OpenAI or any OpenAI-compatible address: agents on the server run on it. The Model card, on the Workspace page.' },
    // What the server offers to connect (the GitHub App, say), once it is set up for the server.
    ...offered.packs.filter((p) => p.ready).map((p) => ({ id: p.pack, title: `Connect ${p.title}`, done: Boolean(p.connected), href: '#/workspace?at=connections', tip: `Choose outside what ${p.title} is given; what it hears reaches this map. The Connections card, on the Workspace page.` })),
    { id: 'agent', title: 'Connect an agent', done: tokens.some((t) => t.kind === 'agent' && !t.revoked_at && t.last_used), href: '#/workspace?at=agent', tip: 'Pick your client and follow its steps' },
    room !== 1 && { id: 'team', title: 'Invite your team', done: members.length > 1, href: '#/workspace?at=team', tip: 'Add people by their email address; each is sent an invitation. On the Workspace page.' },
  ].filter(Boolean);
  const left = steps.filter((s) => !s.done).length;
  if (!left) return host.remove();
  const hide = () => {
    try {
      localStorage.setItem(HIDDEN, me.workspace.id);
    } catch {}
    host.remove();
  };
  const row = (s) =>
    h(
      'li',
      { class: 'row-top' },
      h('span', { class: `pill${s.done ? ' ok' : ''}` }, s.done ? 'done' : 'to do'),
      h('a', { class: `grow gist${s.done ? ' muted' : ''}`, href: s.href, title: s.tip }, s.title),
    );
  host.replaceChildren(
    h(
      'section',
      { class: 'card wide', style: 'margin-bottom: var(--space-8)' },
      h('header', {}, h('h2', {}, title), h('span', { class: 'n', title: 'Steps left' }, left), h('span', { class: 'grow' }), h('button', { title: 'Hide these steps in this browser', onclick: hide }, 'Hide')),
      h('ul', { class: 'rows' }, steps.map(row)),
    ),
  );
}
