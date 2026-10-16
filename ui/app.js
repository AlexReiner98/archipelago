// The pelago web UI. No framework and no build step: it calls the same tools as the CLI through /api/<tool>.
// Each page part is its own module; this one routes between them.

import { SignInNeeded, h, hooks, main, part, showIdentity, signIn, state, store } from './base.js';
import { newEntity } from './forms.js';
import { home } from './home.js';
import { entity } from './item.js';
import { graph } from './lens.js';
import { stale } from './live.js';
import { activity, review } from './review.js';
import { map, mapState, searchBar } from './search.js';
import { time } from './time.js';
import { loadSchema, refreshReviewCount } from './words.js';
import { workspace } from './workspace.js';

// ---- routing -------------------------------------------------------------

// Each page in the menu is its parts, one under the other. What used to be a
// page of its own (a project's roadmap, the list of automations) is on the
// page of the thing it is about or in the search, and its old address leads
// there. Search is one thing at a time under its search box: the search, an
// item, or a graph.
const PAGES = { home: ['home'], review: ['review'], map: ['map', 'item', 'graph'], time: ['time'], workspace: ['workspace'] };
const UNDER = { e: 'map', new: 'map', graph: 'map' };
/** The part an address names, where that is not the address's own name. */
const PART = { e: 'item', new: 'item' };
/** `pulse`: the map changed under the page, which is drawn again where it stands. */
async function route(pulse = false) {
  // What follows a ? says how the page is to be drawn (a lens and a style), not which page it is.
  const [where, query = ''] = location.hash.split('?');
  const [, name = 'home', arg] = where.split('/');
  // Addresses that have been folded into another screen still lead somewhere.
  if (name === 'activity') return activity();
  // The app opens on Home: each project's questions and its next release.
  if (name === 'projects' || name === 'today') return void (location.hash = '#/home');
  // Automations are found like any other kind of item.
  // The graph around an item is its relations, drawn further out, on its own page.
  if (name === 'graph' && arg) return void (location.hash = `#/graph?from=${arg}`);
  if (name === 'automations') return void ((mapState.type = 'sys.automation'), (location.hash = '#/map'));
  // A project's roadmap and its questions are on the project's own page.
  if (name === 'roadmap' || name === 'questions') return void (location.hash = arg ? `#/e/${arg}` : '#/map');
  const page = PAGES[UNDER[name] ?? name] ? (UNDER[name] ?? name) : 'map';
  state.dirty = false;
  stale.hidden = true;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.route === page);
  const draw = {
    home,
    review,
    map: name === 'map' || page !== 'map' ? map : searchBar,
    // The graph around an item is drawn on that item's page, under it.
    item: name === 'e' && arg ? () => entity(arg, new URLSearchParams(query).get('here') ?? undefined) : name === 'new' && (() => newEntity(arg)),
    graph: name === 'graph' && (() => graph(query)),
    time,
    workspace,
  };
  const wanted = PAGES[page];
  if ([...main.children].map((c) => c.dataset.part).join() !== wanted.join()) main.replaceChildren(...wanted.map((p) => h('div', { class: 'part', 'data-part': p })));
  const named = PART[name] ?? name;
  let signedOut;
  try {
    if (!state.schema) await loadSchema();
  } catch (err) {
    if (err instanceof SignInNeeded) return signIn(store.token ? 'Your token is no longer accepted.' : '');
    return main.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  await Promise.all(
    wanted.map(async (p) => {
      const el = part(p);
      el.hidden = !draw[p];
      if (!draw[p]) return el.replaceChildren();
      // The graph is as someone has arranged it: a change elsewhere does not draw it again.
      // The whole map is as someone has arranged it: a change elsewhere does not draw it again.
      if (pulse && el.childElementCount && p === 'graph' && !query) return;
      try {
        await draw[p]();
      } catch (err) {
        if (err instanceof SignInNeeded) signedOut = true;
        else el.replaceChildren(h('div', { class: 'error' }, err.message));
      }
      if (!pulse && p === named && el.isConnected) p === wanted[0] || page === 'map' ? scrollTo(0, 0) : el.scrollIntoView();
    }),
  );
  if (signedOut) return signIn(store.token ? 'Your token is no longer accepted.' : '');
  // The parts above the one asked for have their final height only now, and a list in them a moment later.
  const settle = () => location.hash.split('/')[1] === name && part(named).scrollIntoView();
  if (!pulse && named !== wanted[0] && page !== 'map' && part(named) !== main) (settle(), setTimeout(settle, 700));
  refreshReviewCount();
  showIdentity();
}

hooks.route = route;
window.addEventListener('hashchange', () => route());

route();
