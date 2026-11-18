// The sessions on some items (task e_7csnapar, decision e_v6u2tk3c): each open run linked works_on to an item, as a
// mark every drawing is handed on that item in the answer (`sessions`), so the flow, a painted island and any pack's look
// draw who is on it their own way. A mark says who (the session's name and title), its hue (the style's, picked by the
// name as everywhere: packs/kit/page/words.js sessionHue), its state as the sessions view has it, how long since it was
// last heard (`age`, minutes), how fresh that leaves it (`fresh`, 1 down to 0 over the style's session_fade_from to
// session_fade_to), whether it sleeps (`dormant`: open, not at work, and silent past session_dormant_after, so it stands
// apart from both work under way and work done), and what it spent where it says. Every read is by the items' ids.

import type { KernelContext } from '#pelago/kernel';
import { sessionStates } from './session-state.ts';

/** A session as a mark on an item it works on. */
export interface SessionOn {
  run: string;
  title: string;
  name?: string;
  hue?: string;
  state: string;
  since: string | null;
  age: number | null;
  fresh: number;
  dormant: boolean;
  tokens?: number;
  cost_usd?: number;
}

/** The style's numbers the marks are worked out by, in minutes, where it names them. */
export interface SessionNumbers {
  session_fade_from?: number;
  session_fade_to?: number;
  session_dormant_after?: number;
}

/** The states in which a session is at work: never dormant, however long its turn. */
const AT_WORK = new Set(['working', 'quiet']);
const MINUTE = 60_000;

/** How fresh a session last heard `age` minutes ago is: 1 until fade_from, 0 from fade_to, a straight line between. */
export function freshness(age: number | null, n: SessionNumbers): number {
  const from = n.session_fade_from, to = n.session_fade_to;
  if (age === null || typeof from !== 'number' || typeof to !== 'number' || to <= from) return 1;
  return Math.round(Math.min(1, Math.max(0, (to - age) / (to - from))) * 100) / 100;
}

/** A run's mark on an item: pure, its row, its state and the style in. */
export function sessionOn(
  row: { run: string; title: string; name?: string | null; tokens?: unknown; cost_usd?: unknown },
  state: { state: string; since: string | null; heard?: string },
  { names, hues, numbers, now }: { names: string[]; hues: string[]; numbers: SessionNumbers; now: number },
): SessionOn {
  const age = state.heard ? Math.max(0, Math.round((now - Date.parse(state.heard)) / MINUTE)) : null;
  const k = row.name ? names.indexOf(row.name) : -1;
  const sleep = numbers.session_dormant_after;
  return {
    run: row.run, title: row.title,
    ...(row.name && { name: row.name }),
    ...(k >= 0 && hues.length && { hue: hues[k % hues.length] }),
    state: state.state, since: state.since, age,
    fresh: freshness(age, numbers),
    dormant: !AT_WORK.has(state.state) && state.state !== 'done' && typeof sleep === 'number' && age !== null && age >= sleep,
    ...(typeof row.tokens === 'number' && { tokens: row.tokens }),
    ...(typeof row.cost_usd === 'number' && { cost_usd: row.cost_usd }),
  };
}

/** The sessions on each of some items, by item id: an item nobody is on is left out. */
export async function sessionsOn(ctx: KernelContext, items: string[], now: string = ctx.now().toISOString()): Promise<Record<string, SessionOn[]>> {
  const ids = [...new Set(items)];
  if (!ids.length) return {};
  const rows = (await ctx.reads({ runs_on: { ids, works_on: ctx.registry.relationFamily('works_on'), runs: ctx.registry.family('run') } })) as { item: string; run: string; title: string; name: string | null; tokens: unknown; cost_usd: unknown }[];
  if (!rows.length) return {};
  const [states, style] = await Promise.all([
    sessionStates(ctx, rows.map((r) => r.run), now),
    ctx.call<unknown, { style: Record<string, unknown> }>('answer.view_style', {}).then((a) => a.style, () => ({}) as Record<string, unknown>),
  ]);
  const values = ctx.registry.type('run')?.fields.name?.values;
  const names = Array.isArray(values) ? values : [];
  const hues = Array.isArray(style.hues) ? (style.hues as unknown[]).filter((h): h is string => typeof h === 'string') : [];
  const numbers = (style.numbers && typeof style.numbers === 'object' ? style.numbers : {}) as SessionNumbers;
  const out: Record<string, SessionOn[]> = {};
  for (const r of rows) {
    const s = states.get(r.run);
    if (!s || s.state === 'done') continue;
    (out[r.item] ??= []).push(sessionOn(r, s, { names, hues, numbers, now: Date.parse(now) }));
  }
  return out;
}
