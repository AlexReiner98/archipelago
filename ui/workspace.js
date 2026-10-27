// The Workspace screen: setting the workspace up, in five sections shown one at a time. People: who is in it. Agents:
// what they act with and may do. Look: the theme, the styles, the screens. Packs: what it is made of. Outside: what it
// is tied to beyond the map, and its own settings. Which is open is kept in the address (#/workspace?at=look); a step
// of Start here (ui/start.js) names a card, and lands on its section with that card in view.

import { api, ask, authHeaders, h, part, tell } from './base.js';
import { screensCard } from './nav.js';
import { stylesCard } from './styles-card.js';
import { themesCard } from './themes-card.js';
import { packsCard } from './packs.js';
import { menu } from './words.js';
import { membersCard } from './members-card.js';
import { planCard } from './plan-card.js';
import { modelCard } from './model-card.js';
import { connectionsCard } from './connections-card.js';
import { agentsMayCard, checksCard, tokenRow, tokensCard } from './agents-card.js';
import { backupCard, card, githubCard, ownerRow, serverPacksCard, settingsCard } from './workspace-cards.js';

const SECTIONS = [
  ['people', 'People', 'Who is in this workspace'],
  ['agents', 'Agents', 'What agents act with, and what they may do'],
  ['look', 'Look', 'The theme, the styles and the screens'],
  ['packs', 'Packs', 'The ways of working this workspace is made of'],
  ['outside', 'Outside', 'What it is tied to beyond the map, and its settings'],
];
/** The section each card a step of Start here names is in. */
const CARD_IN = { team: 'people', agent: 'agents', backup: 'outside', model: 'outside', connections: 'outside', github: 'outside' };

/** The section open, and the card asked for, if any. */
let open = 'people';
function asked() {
  const at = new URLSearchParams(location.hash.split('?')[1] ?? '').get('at');
  if (at && SECTIONS.some(([key]) => key === at)) open = at;
  else if (at && CARD_IN[at]) open = CARD_IN[at];
  history.replaceState(null, '', `#/workspace?at=${open}`);
  return at && CARD_IN[at] ? at : null;
}

/** A card a step of Start here leads to, as #/workspace?at=<step>. */
const at = (step, el) => (el && (el.dataset.at = step), el);

export async function workspace() {
  const main = part('workspace');
  const step = asked();
  const me = await (await fetch('/whoami', { headers: authHeaders() })).json();
  const tokensOn = me.auth === 'tokens';
  const admin = !tokensOn || me.actor.admin;
  const [info, tokens, people, members] = await Promise.all([
    api('workspace_info'),
    tokensOn ? api('token_list') : [],
    tokensOn ? api('search', { type: 'person', limit: 200 }) : [],
    tokensOn && me.actor.admin ? api('member_list') : [],
  ]);
  const notice = h('div');
  const fail = (err) => notice.replaceChildren(h('div', { class: 'error gist', title: err.message }, err.message));
  // A word at the top of the page once it is drawn again, brought into view from wherever the button was.
  // Said as (class, words), or as a box drawn whole (a new token's secret).
  const say = (what, text) => {
    const box = main.querySelector('.ws-notice');
    box?.replaceChildren(text === undefined ? what : h('div', { class: `${what} gist`, title: text }, text));
    box?.scrollIntoView({ block: 'center' });
  };
  const live = tokens.filter((t) => !t.revoked_at);
  const row = (t) => tokenRow(t, { me, personName: (id) => people.find((p) => p.id === id)?.title, then: workspace, fail });

  const sections = {
    people: [
      (admin || !info.owner) && card('Owner', null, h('ul', { class: 'rows' }, ownerRow(info.owner, workspace))),
      tokensOn && me.actor.admin && planCard(info.member_limit, members.length, info.ended),
      // A workspace for one person (its limit is one, and it has no more) has no members to manage.
      tokensOn && me.actor.admin && !(info.member_limit?.members === 1 && members.length <= 1) && at('team', membersCard({ me, members, others: live.filter((t) => t.kind === 'human' && !members.some((m) => m.person_id === t.entity_id)), tokenRow: row, then: workspace, fail, say })),
    ],
    agents: [
      tokensOn && at('agent', tokensCard({ tokens: live.filter((t) => t.kind === 'agent'), row, then: workspace, fail, say })),
      admin && agentsMayCard(info, workspace, fail),
      admin && checksCard(info),
    ],
    look: admin ? [themesCard(workspace), stylesCard(workspace), screensCard(workspace)] : [],
    packs: admin ? [packsCard({ h, api, ask, tell, menu, then: workspace }), me.workspace.id === 'default' && serverPacksCard()] : [],
    outside: admin ? [at('model', modelCard()), at('connections', connectionsCard()), at('github', githubCard()), at('backup', backupCard(workspace)), settingsCard(info, workspace, fail)] : [],
  };
  const shown = SECTIONS.filter(([key]) => sections[key].some(Boolean));
  if (!shown.some(([key]) => key === open)) open = shown[0]?.[0] ?? 'people';
  const go = (key) => {
    open = key;
    history.replaceState(null, '', `#/workspace?at=${key}`);
    workspace();
  };
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Workspace'), h('p', { class: 'muted' }, me.workspace.name)),
    shown.length > 1 && h('div', { class: 'switch ws-sections', role: 'tablist' }, shown.map(([key, label, tip]) => h('button', { class: key === open ? 'on' : '', role: 'tab', title: tip, onclick: () => go(key) }, label))),
    h('div', { class: 'ws-notice' }, notice),
    h('div', { class: 'grid' }, sections[open]),
  );
  if (step) setTimeout(() => main.querySelector(`[data-at="${CSS.escape(step)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 400);
}
