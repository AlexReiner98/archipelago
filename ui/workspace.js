// The Workspace screen.

import { api, ask, authHeaders, h, part, tell } from './base.js';
import { screensCard } from './nav.js';
import { packsCard } from './packs.js';
import { RAN, ago, card, chip, hint, link, named, titles, tokensText, when } from './words.js';
import { backupCard, connectBox, githubCard, importCard, operatorCard, ownerCard, secretBox } from './workspace-cards.js';

export async function workspace() {
  const main = part('workspace');
  const me = await (await fetch('/whoami', { headers: authHeaders() })).json();
  const head = h('div', { class: 'page-head' }, h('h1', {}, 'Workspace'), h('p', { class: 'muted' }, me.workspace.name));
  if (me.auth !== 'tokens') {
    const { owner } = await api('workspace_info');
    return main.replaceChildren(
      head,
      h('div', { class: 'grid', style: 'margin-bottom: 14px' }, costsCard(), ownerCard(owner, workspace), backupCard(), packsCard({ h, api, ask, tell, then: workspace }), screensCard(workspace)),
      h('section', { class: 'card' },
        h('div', { class: 'empty' },
          h('strong', {}, 'Single user'), h('span', { class: 'muted', title: 'One workspace, no sign-in; everything done here is done as its owner. To share it, set "auth": "tokens" in pelago.config.json and restart: the first start prints your token.' }, ' \u00b7 no sign-in on this server'),
        ),
      ),
    );
  }
  const [info, tokens, people] = await Promise.all([api('workspace_info'), api('token_list'), api('search', { type: 'person', limit: 200 })]);
  const personName = (id) => people.find((p) => p.id === id)?.title;
  const notice = h('div');
  const fail = (err) => notice.replaceChildren(h('div', { class: 'error', style: 'padding: 10px 14px' }, err.message));
  const live = tokens.filter((t) => !t.revoked_at);

  const tokenRow = (t) =>
    h(
      'li',
      {},
      h(
        'div',
        { class: 'row-top' },
        h('span', { class: 'chip' }, t.kind),
        h('span', { class: 'grow' }, h('strong', {}, t.name), t.admin && [' ', h('span', { class: 'pill' }, 'admin')], t.id === me.actor.token && [' ', h('span', { class: 'pill ok' }, 'this session')], t.repos?.length && [' ', h('span', { class: 'pill', title: `It can change only the work of: ${t.repos.map((id) => named(id)).join(', ')}` }, `${t.repos.length === 1 ? named(t.repos[0]) : `${t.repos.length} repositories`} only`)]),
        t.kind === 'agent' && h('span', { class: 'muted small', title: [t.last_used ? `Last used ${when(t.last_used)}` : 'Never used', t.seen?.length ? `from ${t.seen.length} place${t.seen.length === 1 ? '' : 's'}: ${t.seen.join(', ')}` : ''].filter(Boolean).join(', ') }, t.expires_at ? `expires ${when(t.expires_at)}` : 'never expires'),
        h(
          'button',
          {
            class: 'danger',
            disabled: t.id === me.actor.token,
            title: t.id === me.actor.token ? 'This is the token you are signed in with' : '',
            onclick: async () => (await ask({ title: `Revoke the token "${t.name}"?`, message: 'Whoever uses it is signed out at once.', action: 'Revoke', danger: true })) && api('token_revoke', { id: t.id }).then(workspace, fail),
          },
          'Revoke',
        ),
      ),
      h('div', { class: 'row-sub' }, t.entity_id && `${personName(t.entity_id) ?? t.entity_id} · `, `${t.hint} · `, t.last_used ? ['used ', ago(t.last_used)] : 'never used', t.expires_at && ` · expires ${when(t.expires_at)}`),
    );

  const agentName = h('input', { type: 'text', placeholder: 'Name (claude-code)', style: 'flex: 1; min-width: 180px' });
  // A new agent token ends by itself unless it is said not to, and can be held to the repositories it is for.
  const agentLife = h('select', { title: 'When the token stops working by itself' }, [[90, '90 days'], [30, '30 days'], [365, 'A year'], [0, 'Never expires']].map(([days, label]) => h('option', { value: days }, label)));
  const repoList = await api('search', { type: 'software.repo', limit: 100 }).catch(() => []);
  for (const r of repoList) titles.set(r.id, r.title);
  const agentRepos = new Set();
  const limitLabel = h('summary', { title: 'What the token may change. Limited, it reads the map as you do and changes only those repositories\u2019 work.' }, 'Any repository');
  const agentLimit =
    repoList.length > 0 &&
    h(
      'details',
      { class: 'menu' },
      limitLabel,
      h(
        'div',
        { class: 'menu-items' },
        repoList.map((r) =>
          h('label', { style: 'display: flex; gap: 8px; padding: 5px 12px; white-space: nowrap; cursor: pointer' }, h('input', { type: 'checkbox', onchange: (ev) => (ev.target.checked ? agentRepos.add(r.id) : agentRepos.delete(r.id), (limitLabel.textContent = agentRepos.size ? `${agentRepos.size} repositor${agentRepos.size === 1 ? 'y' : 'ies'} only` : 'Any repository')) }), r.title),
        ),
      ),
    );
  const agentToken = (fallback) => ({ kind: 'agent', name: agentName.value.trim() || fallback, ...(Number(agentLife.value) > 0 && { expires_days: Number(agentLife.value) }), ...(agentRepos.size > 0 && { repos: [...agentRepos] }) });
  const memberName = h('input', { type: 'text', placeholder: 'Name', style: 'flex: 1; min-width: 160px' });
  const memberEmail = h('input', { type: 'text', placeholder: 'Email (optional)', style: 'flex: 1; min-width: 160px' });
  const memberAdmin = h('input', { type: 'checkbox' });
  const accepts = h('input', { type: 'text', value: info.accepts_from.join(', '), placeholder: 'workspace ids, separated by commas', style: 'flex: 1; min-width: 220px' });

  main.replaceChildren(
    head,
    notice,
    h(
      'div',
      { class: 'grid' },
      costsCard(),
      (me.actor.admin || !info.owner) && ownerCard(info.owner, workspace),
      me.actor.admin && backupCard(),
      me.actor.admin && packsCard({ h, api, ask, tell, then: workspace }),
      me.actor.admin && screensCard(workspace),
      h(
        'section',
        { class: 'card wide' },
        h('header', {}, h('h2', { class: 'hinted', title: 'An agent with one of these acts for you: it sees what you see and proposes to you.' }, 'Agent tokens')),
        h('ul', { class: 'rows' }, live.filter((t) => t.kind === 'agent').map(tokenRow)),
        h(
          'div',
          { class: 'toolbar', style: 'padding: 12px 14px' },
          agentName,
          agentLimit,
          agentLife,
          h(
            'button',
            {
              class: 'primary',
              onclick: () =>
                api('token_create', agentToken('claude-code'))
                  .then((made) => workspace().then(() => main.children[1].replaceChildren(connectBox(made))))
                  .catch(fail),
            },
            'Connect an agent',
          ),
          h(
            'button',
            {
              title: 'For an agent that is not Claude Code: the bare token, to send as Authorization: Bearer',
              onclick: () =>
                api('token_create', agentToken('agent'))
                  .then((made) => workspace().then(() => main.children[1].replaceChildren(secretBox(`Token for ${made.name}`, made.token))))
                  .catch(fail),
            },
            'Token only',
          ),
        ),
      ),
      me.actor.admin &&
        h(
          'section',
          { class: 'card wide' },
          h('header', {}, h('h2', { class: 'hinted', title: 'People who can sign in to this workspace.' }, 'Members')),
          h('ul', { class: 'rows' }, live.filter((t) => t.kind === 'human').map(tokenRow)),
          h(
            'div',
            { class: 'toolbar', style: 'padding: 12px 14px' },
            memberName,
            memberEmail,
            h('label', {}, memberAdmin, ' Admin'),
            h(
              'button',
              {
                class: 'primary',
                onclick: () =>
                  api('member_add', { name: memberName.value.trim(), email: memberEmail.value.trim() || undefined, admin: memberAdmin.checked })
                    .then((made) => workspace().then(() => main.children[1].replaceChildren(secretBox(`Sign-in token for ${memberName.value.trim()}. Send it to them privately.`, made.token))))
                    .catch(fail),
              },
              'Add member',
            ),
          ),
        ),
      me.actor.admin &&
        h(
          'section',
          { class: 'card wide' },
          h('header', {}, h('h2', {}, 'Settings')),
          h(
            'dl',
            { class: 'fields' },
            h('dt', {}, 'New things are'),
            h(
              'dd',
              {},
              h(
                'select',
                { onchange: (e) => api('workspace_set', { default_visibility: e.target.value }).then(workspace, fail) },
                [['private', 'Private to their author unless shared'], ['shared', 'Shared with everyone unless made private']].map(([v, label]) => h('option', { value: v, selected: v === info.default_visibility }, label)),
              ),
            ),
            h('dt', {}, 'What agents change'),
            h(
              'dd',
              {},
              h(
                'select',
                { onchange: (e) => api('workspace_set', { agent_changes: e.target.value }).then(workspace, fail) },
                [['hold', 'Is held until I have looked'], ['apply', 'Takes effect as they make it']].map(([v, label]) => h('option', { value: v, selected: v === info.agent_changes }, label)),
              ),
              hint('Either way every change is in the log with who made it and why, and can be undone. Held, the answer to a decision or a hypothesis waits for you too. Taking effect, an agent can settle one: it has to say what was chosen and why, and you are notified on Home.'),
            ),
            h('dt', {}, 'Accept notifications from'),
            h(
              'dd',
              {},
              h(
                'div',
                { class: 'toolbar' },
                accepts,
                h('button', { onclick: () => api('workspace_set', { accepts_from: accepts.value.split(',').map((s) => s.trim()).filter(Boolean) }).then(workspace, fail) }, 'Save'),
              ),
              hint(`Other workspaces on this server that may send this one notifications. This workspace's id is "${info.id}".`),
            ),
          ),
        ),
      me.actor.admin && githubCard(),
      me.actor.admin && importCard(),
      operatorCard(info.id),
    ),
  );
}

// ---- Costs ---------------------------------------------------------------

/** What the work costs over thirty days: each regular payment and its share, and what agents spent by where they ran. */
export function costsCard() {
  const c = card('Costs', { wide: true });
  const money = (n) => `$${n.toFixed(2)}`;
  c.fill(
    api('view', { name: 'costs', params: { days: 30 } }),
    (d) => {
      const paid = d.recurring.items.map((i) =>
        h(
          'li',
          { class: 'row-top' },
          chip(i.type),
          h('span', { class: 'grow', title: i.title }, link(i)),
          i.vendor && h('span', { class: 'muted small' }, i.vendor),
          i.amount === null ? h('span', { class: 'pill warn', title: 'Nobody has said what is paid' }, 'not priced') : h('span', { class: 'muted small', title: `${i.amount} ${i.currency} every ${i.every}` }, i.currency === 'USD' ? `${money(i.per_month)}/mo` : `${i.per_month} ${i.currency}/mo`),
          i.share !== null && i.currency === 'USD' && h('strong', {}, money(i.share)),
        ),
      );
      const spent = d.agents.by.map((s) =>
        h(
          'li',
          { class: 'row-top' },
          h('span', { class: 'chip' }, 'Agents'),
          h('span', { class: 'grow' }, RAN[s.surface] ?? s.surface),
          h('span', { class: 'muted small' }, `${s.runs} run${s.runs === 1 ? '' : 's'} \u00b7 ${tokensText(s.tokens)}`),
          s.unpriced_tokens > 0 && s.cost_usd === 0 ? h('span', { class: 'pill closed', title: 'These runs count tokens and do not say what they cost' }, 'tokens only') : h('strong', {}, money(s.cost_usd)),
        ),
      );
      const node = h(
        'div',
        {},
        h(
          'div',
          { class: 'toolbar fold-bar usage-sums' },
          h('span', { class: 'fact', title: 'What a month costs at this rate: the regular payments, and what agents spent scaled to a month' }, h('span', { class: 'muted' }, 'a month '), h('strong', {}, money(d.per_month))),
          h('span', { class: 'fact', title: 'Paid to run agents through the API, where a run says what it cost' }, h('span', { class: 'muted' }, 'agents '), h('strong', {}, money(d.agents.cost_usd))),
          h('span', { class: 'fact', title: 'Hosting, subscriptions and the like: their share of these days' }, h('span', { class: 'muted' }, 'regular '), h('strong', {}, money(d.recurring.cost_usd))),
          d.agents.unpriced_tokens > 0 && h('span', { class: 'fact', title: 'Used by runs that count tokens and do not say what they cost, such as a session on a subscription: not in the dollars' }, h('span', { class: 'muted' }, 'not priced '), tokensText(d.agents.unpriced_tokens)),
          h('span', { class: 'grow' }),
          d.adds && h('a', { class: 'button', href: `#/new/${d.adds}`, title: 'Hosting, a subscription, a licence, a domain' }, 'Add a cost'),
        ),
        (paid.length > 0 || spent.length > 0) && h('ul', { class: 'rows costs' }, paid, spent),
      );
      return [`${money(d.total_usd)} in ${d.days} days`, node];
    },
    '',
  );
  return c.el;
}
