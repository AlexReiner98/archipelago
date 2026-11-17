// The rules that carry (then.carry, typed islands e_f56ds3ww): an item of a rule's type takes into a field of its own
// the promised field of what it reads in a role (a crossing link, reads, whose props.as is the role), so the rules
// that judge one item (compare, refuse, hold) judge what it reads across islands, with no engine of their own (the
// owner, 16 Nov 2026, e_7vpyg532). Carried on every write of the reader: when it is made, when it is linked, and when it
// is touched again after what it reads moved (the attention pack says so: packs/attention/kernel/moved.ts), so a loop
// passes through time. A value is taken only from a field its item promises (the promised capability).
//
// rewrite fills what the change already writes (a create, an update of the reader); follow adds an update for a reader
// the change only links. Both are judged with the change. The plan is pure (carryPlan): what it reads comes in as Look.

import type { KernelContext } from '#pelago/kernel';

/** What a rule carries: the field it fills, the role it reads by and the promised field it takes. */
export interface Carry { field: string; as: string; read: string }
/** The ops it reads and writes. */
export type Op = { op: string; ref?: string; id?: string; type?: string; from?: string; to?: string; props?: Record<string, unknown> };
/** An item as it reads one: its type and fields. */
export type Item = { type: string; props: Record<string, unknown> };
/** What carrying reads of the map. */
export interface Look {
  /** The rules that carry, each with the types it is about. */
  carries: { types: string[]; carry: Carry }[];
  isA(type: string, ancestor: string): boolean;
  /** Whether a link type crosses islands (reads, or one extending it). */
  crosses(linkType: string): boolean;
  /** The fields a type promises its readers. */
  promised(type: string): string[];
  item(id: string): Promise<Item | undefined>;
  /** The live crossing links from an item: to what, in what role. */
  readings(id: string): Promise<{ to: string; as?: unknown }[]>;
}

const carriesFor = (look: Look, type: string) => look.carries.filter((c) => c.types.some((t) => look.isA(type, t))).map((c) => c.carry);

/** What a change carries: its ops with the carried fields filled where it writes the reader, and the updates for readers it only links. */
export async function carryPlan(ops: Op[], look: Look): Promise<{ ops: Op[]; follow: Op[] }> {
  const out = ops.map((o) => ({ ...o, ...(o.props && { props: { ...o.props } }) }));
  if (!look.carries.length) return { ops: out, follow: [] };
  const made = new Map<string, Op>(); // ref -> its create
  for (const o of out) if (o.op === 'create' && o.ref) made.set(o.ref, o);
  const itemOf = async (key: string): Promise<Item | undefined> => {
    const c = made.get(key);
    return c ? { type: c.type!, props: c.props ?? {} } : look.item(key);
  };
  // Each reader the change touches, and the op of it that writes it, if one does.
  const readers = new Map<string, Op | undefined>();
  for (const o of out) {
    if (o.op === 'create' && o.ref) readers.set(o.ref, o);
    else if (o.op === 'update' && o.id) readers.set(o.id, o);
    else if (o.op === 'link' && o.from && look.crosses(o.type!) && typeof o.props?.as === 'string' && !readers.has(o.from)) readers.set(o.from, undefined);
  }
  const follow: Op[] = [];
  for (const [key, writes] of readers) {
    const reader = await itemOf(key);
    if (!reader) continue;
    const carries = carriesFor(look, reader.type);
    if (!carries.length) continue;
    // In each role, what it reads: its live links, then this change's links, the later winning.
    const byRole = new Map<string, string>();
    if (!made.has(key)) for (const r of await look.readings(key)) if (typeof r.as === 'string') byRole.set(r.as, r.to);
    for (const o of out) if (o.op === 'link' && o.from === key && look.crosses(o.type!) && typeof o.props?.as === 'string') byRole.set(o.props.as, o.to!);
    const now = { ...reader.props, ...(writes?.op === 'update' ? writes.props : {}) };
    const filled: Record<string, unknown> = {};
    for (const c of carries) {
      const to = byRole.get(c.as);
      if (to === undefined) continue;
      const read = await itemOf(to);
      if (!read || !look.promised(read.type).includes(c.read)) continue;
      const value = read.props[c.read] ?? null;
      if (JSON.stringify(now[c.field] ?? null) !== JSON.stringify(value)) filled[c.field] = value;
    }
    if (!Object.keys(filled).length) continue;
    if (writes) writes.props = { ...writes.props, ...filled };
    else follow.push({ op: 'update', id: key, props: filled });
  }
  return { ops: out, follow };
}

/** What carrying reads, through the pack's context: the rules, the types, and the map under the reader's rights. */
function lookOf(ctx: KernelContext): Look {
  const reg = ctx.registry;
  const crossing = new Set(reg.relationFamily(...[...reg.relations.values()].filter((r) => r.crosses).map((r) => r.id)));
  const carries = reg.rules.flatMap((r) => {
    const then = r.then as { carry?: Carry } | undefined;
    const types = r.when?.type === undefined ? [] : [r.when.type].flat();
    return then && typeof then === 'object' && then.carry ? [{ types, carry: then.carry }] : [];
  });
  return {
    carries,
    isA: (t, a) => reg.isA(t, a),
    crosses: (t) => crossing.has(t),
    promised: (t) => ((reg.types.get(t)?.capabilities as { promised?: { fields?: string[] } } | undefined)?.promised?.fields ?? []),
    item: async (id) => {
      const e = (await ctx.reads({ get: id })) as Item | null;
      return e ? { type: e.type, props: e.props ?? {} } : undefined;
    },
    readings: async (id) => {
      const rows = (await ctx.reads({ links: { from: [id], types: [...crossing] } })) as { to_id: string; props?: Record<string, unknown> }[];
      return rows.map((r) => ({ to: r.to_id, as: r.props?.as }));
    },
  };
}

/** write.rewrite: the carried fields filled where the change writes the reader. */
export async function rewrite(ctx: KernelContext, ops: Op[]): Promise<Op[]> {
  return (await carryPlan(ops, lookOf(ctx))).ops;
}

/** write.follow: an update for each reader the change links but does not write. */
export async function follow(ctx: KernelContext, ops: Op[]): Promise<Op[]> {
  return (await carryPlan(ops, lookOf(ctx))).follow;
}
