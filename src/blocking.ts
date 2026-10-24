// What blocks what, derived from relations every time so it cannot go stale: work that depends on something open,
// waits on someone, or needs a resource that is unavailable or held by others as often as it can be held.

import { ACTIVE_HOLDS, type Archipelago } from './pelago.ts';

interface Edge {
  x: string;
  y: string;
  why: 'depends_on' | 'waits_on' | 'resource_unavailable' | 'resource_held';
}

// x is blocked by y when: x depends on something still open; x waits on a
// person, company or agent to answer or act (until the link is removed); x
// needs a resource that is unavailable; or x needs a resource held by
// others (not for x) as many times as its capacity allows.
const EDGES = (only: string) => `
  select r.from_id as x, r.to_id as y, 'depends_on' as why
    from relation r join entity x on x.id = r.from_id join entity y on y.id = r.to_id
   where r.type = any($1::text[]) and r.valid_to is null
     and x.is_open and x.archived_at is null and y.is_open and y.archived_at is null${only}
  union all
  select r.from_id, r.to_id, 'waits_on'
    from relation r join entity x on x.id = r.from_id join entity y on y.id = r.to_id
   where r.type = any($2::text[]) and r.valid_to is null
     and x.is_open and x.archived_at is null and y.archived_at is null${only}
  union all
  select r.from_id, r.to_id, 'resource_unavailable'
    from relation r join entity x on x.id = r.from_id join entity y on y.id = r.to_id
   where r.type = any($3::text[]) and r.valid_to is null
     and x.is_open and x.archived_at is null and y.status = 'unavailable' and y.archived_at is null${only}
`;
const HELD = (only: string) => `
  select n.from_id as x, n.to_id as y, 'resource_held' as why, res.type, res.props, count(*)::int as held
    from relation n join entity x on x.id = n.from_id join entity res on res.id = n.to_id
    join ${ACTIVE_HOLDS} h on h.to_id = n.to_id
   where n.type = any($1::text[]) and n.valid_to is null
     and x.is_open and x.archived_at is null and res.archived_at is null
     and h.from_id <> n.from_id and coalesce(h.props->>'for', '') <> n.from_id${only}
   group by n.from_id, n.to_id, res.type, res.props
`;

export class BlockGraph {
  readonly direct = new Map<string, Edge[]>();

  constructor(edges: Edge[]) {
    for (const edge of edges) this.direct.set(edge.x, [...(this.direct.get(edge.x) ?? []), edge]);
  }

  isBlocked(id: string): boolean {
    return this.direct.has(id);
  }

  /** Whether what it waits on is someone's answer or act, which no work in a repository can supply. */
  waitsOnSomeone(id: string): boolean {
    return (this.direct.get(id) ?? []).some((e) => e.why === 'waits_on');
  }

  /** The things at the end of every chain from id: what actually has to move first. */
  roots(id: string): string[] {
    const roots = new Set<string>();
    const seen = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      const edges = this.direct.get(stack.pop()!) ?? [];
      for (const { y } of edges) {
        if (seen.has(y)) continue;
        seen.add(y);
        if (this.direct.has(y)) stack.push(y);
        else roots.add(y);
      }
    }
    return [...roots];
  }
}

/** Everything the given items wait on, step by step: all a block graph of them needs to read. */
const REACH = (at: number) => `with recursive reach(id) as (select unnest($${at}::text[]) union select r.to_id from relation r join reach c on r.from_id = c.id where r.valid_to is null and r.type = any($${at + 1}::text[])) `;

/** What blocks what: across the map, or for some items only, read as far as what they wait on reaches. */
export async function blockGraph(l: Archipelago, of?: string[]): Promise<BlockGraph> {
  const families = ['depends_on', 'waits_on', 'needs'].map((root) => l.registry.relationFamily(root));
  const scoped = (at: number, x: string) => (of ? [REACH(at), ` and ${x} in (select id from reach)`] : ['', '']);
  const [edgesWith, edgesOnly] = scoped(4, 'r.from_id');
  const { rows } = await l.db.query<Edge>(edgesWith + EDGES(edgesOnly), [...families, ...(of ? [of, families.flat()] : [])]);
  const [heldWith, heldOnly] = scoped(2, 'n.from_id');
  const { rows: held } = await l.db.query<Edge & { type: string; props: Record<string, unknown>; held: number }>(heldWith + HELD(heldOnly), [l.registry.relationFamily('needs'), ...(of ? [of, families.flat()] : [])]);
  const full = held.filter((h) => h.held >= (l.registry.capacity(h) ?? Infinity)).map(({ x, y, why }) => ({ x, y, why }));
  return new BlockGraph([...rows, ...full]);
}

/** Who holds each resource now, and since when. */
export async function heldResources(l: Archipelago) {
  const { rows } = await l.db.query<{ resource: string; title: string; held_by: string; held_by_title: string; held_for: string | null; since: Date }>(
    `select res.id as resource, res.title, h.from_id as held_by, h.holder_title as held_by_title, h.props->>'for' as held_for, h.valid_from as since
     from ${ACTIVE_HOLDS} h join entity res on res.id = h.to_id`,
  );
  return rows;
}