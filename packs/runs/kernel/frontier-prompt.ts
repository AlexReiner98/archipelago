// The frontier narrowed by what a session is asked. When the owner first says what a session is for, the map is
// searched for it and walked a step from what matches, and the session is handed what is already settled there:
// each question its type says how to settle (capability settles) that is closed, with what was chosen and why, so the
// agent does not reopen it; and what is still open to decide. Vector memory returns text like the prompt; this
// returns decisions, with their reasons, tied to what the prompt is about.

import type { KernelContext } from '#pelago/kernel';

/** The links a step from a match walks, and their kinds: what it is part of, about, bears on, or waits for, either way. */
const STEP = ['part_of', 'about', 'bears_on', 'depends_on'];
const MATCHES = 6;
const SAID = 6;

/** Text the owner typed, not an event or another session's message: what is asked of the session is narrowed by it. */
export function askedBy(prompt: unknown): string | undefined {
  const text = String(prompt ?? '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .trim();
  if (!text || text.startsWith('<') || /^(Another Claude session sent a message|Background \(|Task \()/.test(text)) return undefined;
  return text.slice(0, 300);
}

/** What the map has settled and left open on what the session was asked. */
export async function narrowed(ctx: KernelContext, text: string) {
  // A session is named by its first prompt (the sessions pack's names), so sessions are left out: they would match it best.
  const matches = (await ctx.reads({ search_map: { q: text, limit: MATCHES, except: ['run'] } })) as { id: string }[];
  if (!matches.length) return { settled: [], open: [] };
  const ids = matches.map((m) => m.id);
  const near = (await ctx.reads({ steps_near: { ids, types: ctx.registry.relationFamily(...STEP) } })) as string[];
  const around = [...new Set([...ids, ...near])];
  const settling = [...ctx.registry.types.values()].filter((t) => t.capabilities.settles).map((t) => t.id);
  const rows = (await ctx.reads({ settling: { ids: around, types: settling } })) as { id: string; type: string; title: string; status: string; is_open: boolean; props: Record<string, unknown>; updated_at: Date }[];
  const field = (type: string, which: 'chosen' | 'why') => ctx.registry.type(type)?.capabilities.settles?.[which];
  const text_ = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const settled = rows
    .filter((r) => !r.is_open)
    .slice(0, SAID)
    .map((r) => ({ id: r.id, title: r.title, status: r.status, chosen: text_(r.props[field(r.type, 'chosen') ?? 'outcome']), why: text_(r.props[field(r.type, 'why') ?? 'rationale']) }));
  const open = rows
    .filter((r) => r.is_open)
    .slice(0, SAID)
    .map((r) => ({ id: r.id, title: r.title, status: r.status }));
  return { settled, open };
}

/** Cut to its first clause, for a line. */
const gist = (s: string | undefined, n = 140) => (s && s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);

/** What is narrowed, as text for the hook to hand the session; nothing when the map holds nothing on it. */
export function narrowedText(n: Awaited<ReturnType<typeof narrowed>>): string | undefined {
  if (!n.settled.length && !n.open.length) return undefined;
  const lines = ['On what you were just asked, the map already holds this. Do not reopen what is settled unless the owner asks; build on it.'];
  for (const s of n.settled) lines.push(`- Settled: ${s.title} (${s.id}), ${s.status}${s.chosen ? `: ${gist(s.chosen)}` : ''}${s.why ? `. Why: ${gist(s.why)}` : ''}`);
  for (const o of n.open) lines.push(`- Still open: ${o.title} (${o.id}), ${o.status}`);
  return lines.join('\n');
}
