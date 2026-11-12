// A service pack that fills every hook point of the write path, each doing what a task's title asks.
import type { KernelContext } from '#pelago/kernel';

type Op = { op: string; ref?: string; type?: string; title?: string; visibility?: string; props?: Record<string, unknown> };
type Fact = [string, string, string, unknown?];
type Rows = { item(id: string): Promise<{ id: string; title: string } | undefined>; replace(t: string, c: string, id: string, rows: Record<string, unknown>[]): Promise<void> };

let moving = 0;

/** "Widen" makes it public, "Tag" sets a field the pack does not fill, "Narrow" makes it private: only the last keeps the bounds. */
export function rewrite(_ctx: KernelContext, ops: Op[]): Op[] {
  return ops.map((o) => {
    if (o.op !== 'create') return o;
    if (o.title === 'Widen') return { ...o, visibility: 'public' };
    if (o.title === 'Tag') return { ...o, props: { ...o.props, tag: 1 } };
    if (o.title === 'Narrow') return { ...o, visibility: 'private' };
    return o;
  });
}

export function validate(_ctx: KernelContext, ops: Op[], who?: { human: boolean }) {
  return {
    refusals: ops.filter((o) => o.title === 'Forbidden').map(() => `"Forbidden" is not a title here${who?.human ? ', even for a person' : ''}`),
    warnings: ops.filter((o) => o.title === 'Careful').map(() => 'careful with that'),
  };
}

/** "Follow" is followed by a second task; "Moving" by one that differs each time it is asked. */
export function follow(_ctx: KernelContext, ops: Op[]): Op[] {
  return ops.flatMap((o) => (o.op !== 'create' ? [] : o.title === 'Follow' ? [{ op: 'create', type: 'task', title: 'Followed' }] : o.title === 'Moving' ? [{ op: 'create', type: 'task', title: `Moved ${moving++}` }] : []));
}

/** One row of probe_row for each item titled "Projected", by its title. */
export async function project(_ctx: KernelContext, facts: Fact[], rows: Rows) {
  for (const id of new Set(facts.filter((f) => f[0] === '+' && f[2] === 'title' && f[3] === 'Projected').map((f) => f[1]))) {
    const item = await rows.item(id);
    if (item) await rows.replace('probe_row', 'item', id, [{ item: id, title: item.title }]);
  }
}

export function after(_ctx: KernelContext, entry: { ops: Op[] }) {
  if (entry.ops.some((o) => o.title === 'Fails after')) throw new Error('the probe failed after');
}

export function retype(_ctx: KernelContext, from: string, to: string): Op[] {
  return [{ op: 'create', type: 'task', title: `Retyped ${from} to ${to}` }];
}
