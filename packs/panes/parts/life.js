// What happens to the tabs when an agent shows something, and as a chat ends or rests (the panes pack's part, task
// e_d5ewsvgf): what packs/panes/page/pane-land.js and tab-life.js do on the page, done to the model (./model.js) with no
// page. The model keeps beside its tabs who was heard (`heard`), where each session last landed (`landed`, by
// `<tab>:<pane>`) and the chats the owner closed a tab of (`dismissed`). Where a step lands is ./route.js's rule.
//
// What the page tells the part beside: the items each pane draws (`ids` on the pane, from its canvas), for a tab that
// watches what it draws, and when the reader last worked in each pane (`m.busy`, by pane, not kept), so a show passes
// them by.

import * as M from './model.js';
import { route, sessionOf, SHOWN, WATCH } from './route.js';

const isRun = (key) => /^e_[a-z0-9]{8}$/.test(key ?? '');
/** An item's page, as a show names one: it opens over the pane that draws it when that pane is in focus. */
const itemOf = (at) => /^e\/(e_[a-z0-9]{8})(?:\?|$)/.exec(at)?.[1];

/** What the model keeps beside its tabs, made where it is missing. */
export function sides(m) {
  m.heard ??= {};
  m.landed ??= {};
  m.dismissed ??= [];
  return m;
}

/** Hear a step: its session can be followed, called by its chat's title, else by its agent's name. */
export function hear(m, step) {
  const key = sessionOf(step);
  if (!key) return;
  const agent = String(step.actor ?? '').split(/[/:]/).at(-1);
  const was = sides(m).heard[key];
  m.heard[key] = { name: step.name ?? was?.name ?? agent, called: step.title ?? step.label ?? was?.called ?? agent, at: Math.max(step.at ?? 0, was?.at ?? 0), ...(step.run && { run: step.run }), ended: step.ends ? true : step.opens ? false : Boolean(was?.ended) };
}
/** What a session is called on a tab. */
export const nameOf = (m, key) => m.heard?.[key]?.called ?? (isRun(key) ? key : String(key ?? '').split(/[/:]/).at(-1));

/** What a tab opened for a chat carries: whom it follows, whose it is, what it is called and its hue's word. */
export const chatTab = (m, run) => ({ follows: run, chat: run, by: run, named: nameOf(m, run), word: m.heard?.[run]?.name });

/** How long a press, a scroll or a key keeps a pane busy, in milliseconds. */
const quietAfter = 20_000;
/** Whether the reader is at work in pane `id` now. */
const busy = (m, id, now) => now - (m.busy?.[id] ?? 0) < quietAfter;
/** What tab `t` watches, when it watches: the items its panes draw, but for the one its sessions share. */
export const watched = (t) => (t.follows === WATCH ? [...new Set(t.groups.filter((g) => t.panes[g]?.slot !== SHOWN).flatMap((g) => t.panes[g]?.ids ?? []))] : undefined);

/** The tabs as the rule reads them. */
function tabsFor(m, step, at, now) {
  return m.list.map((t) => ({
    id: t.id,
    follows: t.follows ?? 'none',
    chat: t.chat,
    watches: watched(t),
    front: t.id === m.front,
    panes: t.groups.map((id) => ({ id, slot: t.panes[id]?.slot, held: t.panes[id]?.held, by: t.panes[id]?.by, focus: id === M.focusOf(t), landed: m.landed[`${t.id}:${id}`], draws: M.named(t.panes[id]?.at) === M.named(at), blank: t.panes[id]?.at === M.BLANK, busy: t.id === m.front && busy(m, id, now) })),
  }));
}

/** Tab `t` watches what it draws from now on: the owner's, as a tab kept is, following no one session. */
export function watchTab(t) {
  delete t.chat;
  delete t.ended;
  for (const g of t.groups) (delete t.panes[g].by, delete t.panes[g].held);
  Object.assign(t, { follows: WATCH, named: undefined, word: undefined });
  return t;
}
/** Make the tab session `run` last landed in watch what it draws: the owner approved the plan shown. */
function watchFrom(m, run) {
  const last = (t) => Math.max(0, ...t.groups.map((g) => m.landed[`${t.id}:${g}`]).filter((l) => l?.session === run).map((l) => l.at));
  const t = m.list.filter((o) => last(o) > 0).sort((a, b) => last(b) - last(a))[0];
  if (t) watchTab(t);
}

/**
 * Land step `step` (a show: `hash`, `run` or `actor`, `pane`, `focus`, `canvas`): answers `later` to be tried again, or
 * what the page does: `go` an address to write when the tab in sight moved, `ring` the pane lit. The model is changed.
 */
export function land(m, step, newId, now = Date.now()) {
  sides(m);
  const did = landing(m, step, newId, now);
  if (step.watch) watchFrom(m, sessionOf(step));
  return did;
}
function landing(m, step, newId, now) {
  hear(m, step);
  const at = M.asPane(String(step.hash ?? ''));
  const page = step.canvas ? undefined : itemOf(at);
  const session = sessionOf(step);
  if (step.takes) takeOver(m, step.takes, session);
  revive(m, session);
  const to = route(step, tabsFor(m, step, at, now), { drawable: M.drawable(at) });
  const lit = (t, pane) => {
    m.landed[`${t.id}:${pane}`] = { session, at: now };
    const p = t.panes[pane];
    if (p && t.follows !== session && !p.slot && pane !== M.focusOf(t)) p.held = session;
    if (p) ((p.said = step.did), (p.ring = now));
  };
  if (to.nowhere) return {};
  if (to.later) return { later: true };
  if (to.open) {
    const id = M.openTab(m, newId, M.drawable(at) ? M.paneAt(at) : M.BLANK, { ...chatTab(m, to.open.follows), ...(to.open.slot && { slot: to.open.slot }) }, to.front);
    const t = M.tabOf(m, id);
    if (page || !M.drawable(at)) t.sheet = page ? `e/${page}` : at.split('?')[0];
    lit(t, M.focusOf(t));
    return to.front ? { go: `#/${at}` } : {};
  }
  const t = M.tabOf(m, to.tab);
  if (!t) return {};
  if (to.slot && t.panes[to.pane]) t.panes[to.pane].slot = to.slot;
  const split = () => M.openPane(t, newId, M.paneAt(at), to.split.side, t.groups.at(-1), { anew: true, ...(!to.split.shared && { by: session }), ...(to.split.slot && { slot: to.split.slot }), ...(!to.split.slot && t.follows !== session && { held: session }) });
  // Not a canvas (a screen, the workspace): the page opens over the tab's pane in focus.
  if (!M.drawable(at)) {
    if (to.front) M.toFront(m, t.id);
    if (t.id === m.front) return { go: `#/${at}` };
    t.sheet = at.split('?')[0];
    t.unseen = true;
    return {};
  }
  const pane = to.split ? split() : to.pane;
  if (!pane) return {};
  if (to.side === 'alone') M.only(t, pane);
  else if (to.side && !to.split) M.place(t, pane, to.side, t.groups.find((g) => g !== pane) ?? pane);
  M.goPane(t, pane, M.paneAt(at));
  lit(t, pane);
  if (!to.front && t.id !== m.front) {
    if (page && pane === M.focusOf(t)) t.sheet = `e/${page}`;
    t.unseen = true;
    return {};
  }
  M.toFront(m, t.id);
  if (page && pane === M.focusOf(t)) return { go: `#/e/${page}?${(t.panes[pane].at.split('?')[1] ?? '')}`, ring: pane };
  return { go: pane === M.focusOf(t) ? M.tabHref(t) : undefined, ring: pane };
}

/** The panes of tab `t` made for chat `run`. */
const madeFor = (t, run) => t.groups.filter((g) => t.panes[g]?.by === run);

/** Take chat `run`'s panes out of tab `t`: a tab left with none goes, one left with the owner's is theirs. */
export function settle(m, t, run) {
  const going = madeFor(t, run);
  for (const g of going) (delete t.panes[g], delete m.landed?.[`${t.id}:${g}`]);
  t.groups = t.groups.filter((g) => !going.includes(g));
  t.sizes = t.groups.map(() => 1 / t.groups.length);
  if (!t.groups.includes(t.focus)) t.focus = t.groups[0];
  if (t.chat === run) delete t.chat;
  if (t.follows === run) t.follows = 'none';
  t.ended = (t.ended ?? []).filter((r) => r !== run);
  if (!t.ended.length) delete t.ended;
  if (!t.groups.length) m.list = m.list.filter((o) => o !== t);
}

/** Close what the tabs keep for chat `run`: in sight, where the reader is, it is struck and goes once they leave. */
function close(m, newId, run, found, whose) {
  for (const t of [...m.list]) {
    if (!whose(t) && !madeFor(t, run).length) continue;
    if (t.id === m.front && !found && (t.chat === run || madeFor(t, run).includes(M.focusOf(t)))) t.ended = [...new Set([...(t.ended ?? []), run])];
    else settle(m, t, run);
  }
  // A page always keeps a tab of the owner's.
  if (!m.list.length) m.list = [M.freshTab(newId)];
  if (!m.list.some((t) => t.id === m.front)) m.front = m.list[0].id;
}

/** Chat `run` has ended: its tabs and panes go, the owner's stay; found ended as the page opens, all at once. */
export function ended(m, newId, run, found = false) {
  if (!isRun(run)) return;
  sides(m);
  if (m.heard[run]) m.heard[run].ended = true;
  m.dismissed = m.dismissed.filter((r) => r !== run);
  for (const t of m.list) for (const g of t.groups) if (t.panes[g]?.held === run) delete t.panes[g].held;
  close(m, newId, run, found, (t) => t.chat === run || t.follows === run);
}
/** Chat `run` has gone quiet or waits: its own tab goes as at its end; a tab of the owner's that follows it stays. */
export function rested(m, newId, run) {
  if (isRun(run)) close(m, newId, run, false, (t) => t.chat === run);
}
/** Chat `run` was heard from again: a tab struck for it is its own again. */
export function revive(m, run) {
  sides(m).dismissed = m.dismissed.filter((r) => r !== run);
  for (const t of m.list) if (t.ended?.includes(run)) (t.ended = t.ended.filter((r) => r !== run)), t.ended.length || delete t.ended;
}
/** After a clear the chat goes on as session `now`: everything kept for `before` is its now. */
export function takeOver(m, before, now) {
  if (!isRun(before) || !isRun(now)) return;
  const swap = (v) => (v === before ? now : v);
  for (const t of m.list) {
    t.follows = swap(t.follows);
    if (t.chat) t.chat = swap(t.chat);
    if (t.ended) t.ended = t.ended.filter((r) => r !== before);
    for (const g of t.groups) for (const k of ['held', 'by']) if (t.panes[g]?.[k]) t.panes[g][k] = swap(t.panes[g][k]);
  }
  for (const [key, l] of Object.entries(sides(m).landed)) if (l.session === before) m.landed[key] = { ...l, session: now };
}
/** A tab struck because its chat ended goes once the reader leaves it. */
export function leaving(m, t) {
  for (const run of [...(t?.ended ?? [])]) settle(m, t, run);
}
/** The chats open now (the `sessions` view): those gone keep no tab, nor those quiet or waiting. */
export function mirror(m, newId, open) {
  const live = new Set(open.map((s) => s.id));
  sides(m).dismissed = m.dismissed.filter((r) => live.has(r));
  const kept = new Set();
  for (const t of m.list) {
    for (const run of [t.chat, t.follows]) if (isRun(run)) kept.add(run);
    for (const g of t.groups) for (const run of [t.panes[g]?.by, t.panes[g]?.held]) if (isRun(run)) kept.add(run);
  }
  for (const run of kept) if (!live.has(run)) ended(m, newId, run, true);
  // A session no longer open has ended, tab or none: no tab offers to follow it.
  for (const [run, s] of Object.entries(m.heard)) if (isRun(run) && !live.has(run)) s.ended = true;
  for (const s of open) {
    const was = m.heard[s.id];
    m.heard[s.id] = { name: s.name ?? was?.name ?? s.title, called: s.title ?? was?.called, at: Date.parse(s.last_seen) || was?.at || 0, run: s.id, ended: false, ...(s.session?.state && { state: s.session.state }), ...(s.session?.for && { for: String(s.session.for).slice(0, 200) }) };
    if (kept.has(s.id) && (s.status === 'waiting' || (s.stale && !s.busy))) rested(m, newId, s.id);
  }
}
