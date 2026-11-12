// What a session is called: its chat's title, as its client gives it (Claude Code's title, a bot's name for its chat),
// kept live as the chat is renamed; before it has one, what it works on, else where it runs (decision e_r2qbv95d: no
// island word on any screen). Each open session also holds a word the run type declares among the values of its field
// `name`, none held by another open session, never shown: where it stands among those values picks its mark among the
// style's hues (ui/words.js), so two at work at once are told apart at a glance. The words are the pack's; the colours
// are the style's.

import { bookkeep } from './bookkeeping.ts';
import type { Archipelago, Entity } from '../../../src/pelago.ts';
import { pageStyle } from '../../../src/styles.ts';
import { bypassingRls } from '../../../src/outbox.ts';
import { took } from '../../../src/presence.ts';

/** The words a session may be named, in the order their marks take the style's hues. */
export function sessionNames(l: Archipelago): string[] {
  const values = l.registry.type('run')?.fields.name?.values;
  return Array.isArray(values) ? values : [];
}

/** The most a run's title takes, as any item's name. */
const TITLE_MOST = 60;
/** A title cut to a name's length. */
export const cutTitle = (title: string) => (title.length > TITLE_MOST ? `${title.slice(0, TITLE_MOST - 1).trimEnd()}…` : title);
/** How a title named after where a session runs begins: until its chat is titled, its first prompt names it instead. */
const PLACED = 'Session in ';
/** What a session is called before its chat has a title: what it works on, else where it runs. */
export const sessionTitle = (fallback: { task?: string; place?: string }) => cutTitle(fallback.task ?? `${PLACED}${fallback.place ?? 'an unknown folder'}`);
/** A first prompt's opening words, as a name: its first line, cut at a word to a name's length. */
export const promptTitle = (prompt: unknown): string => {
  const line = typeof prompt === 'string' ? (prompt.split('\n').find((l) => l.trim()) ?? '').trim().replace(/\s+/g, ' ') : '';
  if (line.length <= TITLE_MOST) return line;
  const cut = line.slice(0, TITLE_MOST - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : cut.length).trimEnd()}…`;
};

/**
 * A session still named after its folder, prompted: named by what was asked, until its client gives it a title (which
 * then replaces this, as its label). One named after its task, or titled, keeps its name.
 */
export async function sessionPromptNamed(l: Archipelago, run: Entity, prompt: unknown, actor = 'agent:claude-code'): Promise<void> {
  const title = promptTitle(prompt);
  if (!title || run.props.label || !run.title.startsWith(PLACED)) return;
  await bookkeep(l, actor, { ops: [{ op: 'update', id: run.id, title }], reason: 'Session named by its first prompt' });
  await took((await bypassingRls(l)).db, l, { kind: 'other', actor, did: 'titled', run: run.id }, true).catch(() => {});
}
/** A title as a client said it: its words, trimmed, or nothing. */
export const saidTitle = (label: unknown) => (typeof label === 'string' ? label.trim().replace(/\s+/g, ' ').slice(0, 200) : '');

/** What the session's client calls it now: kept as its label, and its title. Only a new one is written. */
export async function sessionLabelled(l: Archipelago, run: Entity, label: unknown, actor = 'agent:claude-code'): Promise<void> {
  const said = saidTitle(label);
  if (!said || (said === run.props.label && run.title === cutTitle(said))) return;
  await bookkeep(l, actor, { ops: [{ op: 'update', id: run.id, title: cutTitle(said), props: { label: said } }], reason: 'Session titled' });
  // Every page open hears it at once: its tab is named anew (ui/pane-route.js reads the title off the step).
  await took((await bypassingRls(l)).db, l, { kind: 'other', actor, did: 'titled', run: run.id }, true).catch(() => {});
}

/** How many hues the workspace's style tells things apart by. */
async function hueCount(l: Archipelago): Promise<number> {
  const hues = (await pageStyle(l, {}, false).catch(() => undefined))?.style.hues;
  return Array.isArray(hues) && hues.length ? hues.length : 1;
}

/**
 * A name for a session starting now: one no open session holds, whose hue none holds either while there is one,
 * picked at random among those so that two maps do not name their first session alike. With every word held, any.
 */
export async function mintName(l: Archipelago, pick = Math.random): Promise<string | undefined> {
  const names = sessionNames(l);
  if (!names.length) return undefined;
  const { rows } = await l.db.query<{ name: string }>(
    `select props->>'name' as name from entity where type = any($1::text[]) and is_open and archived_at is null and props ? 'name'`,
    [l.registry.family('run')],
  );
  const held = rows.map((r) => r.name);
  const hues = await hueCount(l);
  const heldHues = new Set(held.map((n) => names.indexOf(n)).filter((i) => i >= 0).map((i) => i % hues));
  const free = names.filter((n) => !held.includes(n));
  const apart = free.filter((n) => !heldHues.has(names.indexOf(n) % hues));
  const from = apart.length ? apart : free.length ? free : names;
  return from[Math.floor(pick() * from.length)];
}
