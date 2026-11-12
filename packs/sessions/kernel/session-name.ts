// What a session is called: its chat's title, as its client gives it (Claude Code's title, a bot's name for its chat),
// kept live as the chat is renamed; before it has one, what it works on, else where it runs (decision e_r2qbv95d: no
// island word on any screen). Each open session also holds a word the run type declares among the values of its field
// `name`, none held by another open session, never shown: where it stands among those values picks its mark among the
// style's hues (ui/words.js), so two at work at once are told apart at a glance. The words are the pack's; the colours
// are the style's.

// A name that changes is shown on the owner's page at once (a step, presence's): each function that names a session says
// whether it did, and the sessions pack's l-facing calls (packs/sessions/kernel/sessions.ts) show it, as presence names no service yet.

import type { KernelContext } from '#pelago/kernel';
import { bookkeep } from './bookkeeping.ts';
import type { Item } from './types.ts';

/** The words a session may be named, in the order their marks take the style's hues. */
export function sessionNames(ctx: Pick<KernelContext, 'registry'>): string[] {
  const values = ctx.registry.type('run')?.fields.name?.values;
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
export async function sessionPromptNamed(ctx: KernelContext, run: Pick<Item, 'id' | 'title' | 'props'>, prompt: unknown, actor = 'agent:claude-code'): Promise<boolean> {
  const title = promptTitle(prompt);
  if (!title || run.props.label || !run.title.startsWith(PLACED)) return false;
  await bookkeep(ctx, actor, { ops: [{ op: 'update', id: run.id, title }], reason: 'Session named by its first prompt' });
  return true;
}
/** A title as a client said it: its words, trimmed, or nothing. */
export const saidTitle = (label: unknown) => (typeof label === 'string' ? label.trim().replace(/\s+/g, ' ').slice(0, 200) : '');

/** What the session's client calls it now: kept as its label, and its title. Only a new one is written: true when it was, for every page open to hear it at once (its tab is named anew: ui/pane-route.js reads the title off the step). */
export async function sessionLabelled(ctx: KernelContext, run: Pick<Item, 'id' | 'title' | 'props'>, label: unknown, actor = 'agent:claude-code'): Promise<boolean> {
  const said = saidTitle(label);
  if (!said || (said === run.props.label && run.title === cutTitle(said))) return false;
  await bookkeep(ctx, actor, { ops: [{ op: 'update', id: run.id, title: cutTitle(said), props: { label: said } }], reason: 'Session titled' });
  return true;
}

/** How many hues the workspace's style tells things apart by. */
async function hueCount(ctx: KernelContext): Promise<number> {
  const hues = (await ctx.call<object, { style: Record<string, unknown> }>('answer.view_style', {}).catch(() => undefined))?.style.hues;
  return Array.isArray(hues) && hues.length ? hues.length : 1;
}

/**
 * A name for a session starting now: one no open session holds, whose hue none holds either while there is one,
 * picked at random among those so that two maps do not name their first session alike. With every word held, any.
 */
export async function mintName(ctx: KernelContext, pick = Math.random): Promise<string | undefined> {
  const names = sessionNames(ctx);
  if (!names.length) return undefined;
  const held = (await ctx.reads({ names_held: true })) as string[];
  const hues = await hueCount(ctx);
  const heldHues = new Set(held.map((n) => names.indexOf(n)).filter((i) => i >= 0).map((i) => i % hues));
  const free = names.filter((n) => !held.includes(n));
  const apart = free.filter((n) => !heldHues.has(names.indexOf(n) % hues));
  const from = apart.length ? apart : free.length ? free : names;
  return from[Math.floor(pick() * from.length)];
}
