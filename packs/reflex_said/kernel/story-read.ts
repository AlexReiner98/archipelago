// The read said_story (surface's slot surface.reads): the tree's story over a window, for the drawing. It reads the
// sayings, records, misses, the rules in force and their firings, each bounded (the window's days, this pack's own
// stream, the ids asked, the uses stream's days); story.ts and rule-nodes.ts decide.

import type { KernelContext } from '#pelago/kernel';
import { misses } from './misses-read.ts';
import { MOST, said_record } from './reads.ts';
import { sayingsOf, tierOf } from './record.ts';
import { firingsOf, ruleNodes, rulesRead, type RuleDecl } from './rule-nodes.ts';
import { storyOf, type StoryNode } from './story.ts';
import { schemaOf } from './schema-read.ts';

const DAYS = 30;
const DAYS_MOST = 90;
/** The most sayings one story reads of this pack's stream. */
const ENTRIES_MOST = 2000;

type Kept = { id: string; title: string; is_open: boolean; status?: string | null; props: Record<string, unknown>; about: string[] };
type Preset = { id: string; title: string; type?: string; props: Record<string, unknown> };

const listed = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const day = (at: Date) => at.toISOString().slice(0, 10);

/** `said_story: { ids, days? }`: the story of the tree over the last days (story.ts). */
export async function said_story(ctx: KernelContext, q: { said_story: { ids?: unknown; days?: unknown } }) {
  const asked = Array.isArray(q.said_story?.ids) ? [...new Set((q.said_story.ids as unknown[]).filter((id): id is string => typeof id === 'string' && !!id))].slice(0, MOST) : [];
  const days = Math.min(DAYS_MOST, Math.max(1, Number(q.said_story?.days ?? DAYS) || DAYS));
  const now = ctx.now();
  const fromAt = new Date(now.getTime() - days * 86_400_000);
  const range: [string, string] = [day(fromAt), day(now)];
  // Every saying in the window, of every instruction: this pack's own stream, its days only.
  const sayings = sayingsOf((await ctx.reads({ own_stream: { days: range, limit: ENTRIES_MOST } })) as { at: string; facts: unknown[] }[]);
  const { kept } = (await ctx.reads({ told_from: {} })) as { kept: Kept[] };
  const keptBy = new Map(kept.map((k) => [k.id, k]));
  const presets = ctx.registry.packs.flatMap((p) => ((p.styles ?? []) as Preset[]).filter((s) => s.type === 'instruction').map((s) => ({ ...s, pack: p.id })));
  const presetBy = new Map(presets.map((p) => [p.id, p]));
  const types = asked.length ? ((await ctx.reads({ ids: asked.filter((id) => id.startsWith('e_')) })) as { id: string; type: string }[]) : [];
  const typeOf = new Map(types.map((t) => [t.id, t.type]));
  const node = (id: string): StoryNode | undefined => {
    const k = keptBy.get(id);
    if (k) {
      const type = typeOf.get(id) ?? (k.status === 'trial' ? 'reflex' : undefined);
      const learned = type === 'reflex';
      return { id, kind: 'instruction', pack: learned ? 'reflex' : k.about.length ? 'repository' : 'workspace', tier: tierOf(id, { type }, undefined), ...(k.status && { status: k.status }), for: listed(k.props.for), title: k.title };
    }
    const p = presetBy.get(id);
    return p && { id, kind: 'instruction', pack: p.pack, tier: tierOf(id, undefined, p.pack), for: listed(p.props.for), title: p.title };
  };
  const askedNodes = asked.map(node).filter((n): n is StoryNode => !!n);
  const others = [...new Set(sayings.map((s) => s.id))].filter((id) => !asked.includes(id)).map(node).filter((n): n is StoryNode => !!n);
  // Records of what is drawn, a read of the stream per instruction, MOST at a time.
  const drawn = [...askedNodes, ...others].map((n) => n.id);
  const records = [];
  for (let i = 0; i < drawn.length; i += MOST) records.push(...(await said_record(ctx, { said_record: { ids: drawn.slice(i, i + MOST), days } })));
  // The rules in force, and how often each fired by day (the uses stream's counts, its days only).
  const rules = ruleNodes(ctx.registry.rules as RuleDecl[]);
  const uses = (await ctx.reads({ uses_lately: { days: range } })) as { facts: unknown[] }[];
  const fired = firingsOf(uses, new Set(rules.map((r) => r.id)), range);
  const trials = new Set(kept.filter((k) => k.status === 'trial').map((k) => k.id));
  // The schema: every type and the checks it implies; each check's refusals counted by day beside the rules' firings.
  const schema = await schemaOf(ctx, days);
  const checked = new Map<string, number>();
  for (const n of schema) for (const at of n.fired ?? []) checked.set(`${n.id} ${at.slice(0, 10)}`, (checked.get(`${n.id} ${at.slice(0, 10)}`) ?? 0) + 1);
  const checks = [...checked].map(([key, n]) => { const [id, d] = key.split(' '); return { id, day: d, effect: 'refused' as const, n }; });
  return storyOf({ from: fromAt.toISOString(), to: now.toISOString(), asked: askedNodes, others, rules, schema: schema.map(({ fired: _f, ...n }) => n), fired: [...fired, ...checks], sayings, records, misses: await misses(ctx, { misses: { days } }), trials });
}

/** `said_rules: { days? }`: every rule in force, with where it applies and each time it fired in the window (rule-nodes.ts). */
export async function said_rules(ctx: KernelContext, q: { said_rules: { days?: unknown } }) {
  const days = Math.min(DAYS_MOST, Math.max(1, Number(q.said_rules?.days ?? DAYS) || DAYS));
  const now = ctx.now();
  const range: [string, string] = [day(new Date(now.getTime() - days * 86_400_000)), day(now)];
  const rules = ruleNodes(ctx.registry.rules as RuleDecl[]);
  const uses = (await ctx.reads({ uses_lately: { days: range } })) as { facts: unknown[] }[];
  return rulesRead(rules, firingsOf(uses, new Set(rules.map((r) => r.id)), range));
}

