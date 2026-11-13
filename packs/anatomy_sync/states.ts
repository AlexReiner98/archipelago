// Where each pack stands in this workspace, on the island: on (active), waiting for a name nothing provides, or off,
// and why. The kernel tells the sync pack.changed when a pack is turned on or off or a pack kept as an item is made,
// changed or retired; the sync reads every pack's state (the read pack_states) and brings the island's packs to it. A
// pack kept as an item, which no repository holds, joins the island here, as a pack at home on the map.
//
// Pure: the states and the island's packs in, ops out. The code's own sync (plan.ts) never touches a pack's state, and
// never archives a pack kept as an item.

/** A pack's state, as the read pack_states answers it. */
export interface PackStateRead { id: string; title?: string; version?: string; state: 'active' | 'waiting' | 'off'; why?: string; item?: string }
/** A pack on the island, as an items read answers it. */
export interface IslandPack { id: string; title?: string; props: Record<string, any> }
type Op = Record<string, unknown>;

/** Not offered to this workspace by the server: off, and why. */
const NOT_OFFERED = 'Not offered to this workspace on this server';

/** The ops that bring the island's packs to the states the workspace reports. */
export function stateOps(states: PackStateRead[], packs: IslandPack[], island: string): { ops: Op[]; changed: string[] } {
  const ops: Op[] = [], changed: string[] = [];
  const held = new Map(packs.map((p) => [String(p.props.pack_id), p]));
  const told = new Set<string>();
  for (const s of states) {
    told.add(s.id);
    const want = { state: s.state, why: s.why ?? '' };
    const p = held.get(s.id);
    if (p) {
      if (p.props.state !== want.state || (p.props.why ?? '') !== want.why) { ops.push({ op: 'update', id: p.id, props: want }); changed.push(s.id); }
    } else if (s.item) {
      ops.push({ op: 'create', type: 'anatomy.pack', title: (s.title ?? s.id).slice(0, 60), props: { island, pack_id: s.id, home: 'item', kind: 'island', version: s.version ?? '', ...want } });
      changed.push(s.id);
    }
  }
  // A pack the island holds that the workspace is not offered: off, saying so.
  for (const [id, p] of held) if (!told.has(id) && (p.props.state !== 'off' || p.props.why !== NOT_OFFERED)) { ops.push({ op: 'update', id: p.id, props: { state: 'off', why: NOT_OFFERED } }); changed.push(id); }
  return { ops, changed };
}

type Ctx = { read: (q: Record<string, unknown>) => Promise<any> };

/** Read the states and the island's packs, and answer with the ops that bring them together. */
export async function statesNow(ctx: Ctx): Promise<{ ops: Op[]; reason: string } | { ops?: undefined; reason: string }> {
  const [sync] = await ctx.read({ items: { type: 'anatomy.sync' }, fields: ['island'] });
  if (!sync?.props?.island) return { reason: 'The island has no sync item to say which island it is.' };
  const [states, packs] = await Promise.all([ctx.read({ pack_states: true }), ctx.read({ items: { type: 'anatomy.pack' }, fields: ['pack_id', 'state', 'why', 'home', 'island'] })]);
  const { ops, changed } = stateOps(states ?? [], (packs ?? []).filter((p: IslandPack) => p.props?.island === sync.props.island), String(sync.props.island));
  return ops.length ? { ops, reason: `Pack anatomy: where ${changed.length === 1 ? `the ${changed[0]} pack stands` : `${changed.length} packs stand`} in this workspace` } : { reason: 'The island already shows where every pack stands.' };
}

/** The kernel's pack.changed: the island's packs brought to where each stands now. */
export async function packChanged(_input: unknown, ctx: Ctx) {
  const now = await statesNow(ctx);
  return now.ops ? { ops: now.ops, reason: now.reason } : { answer: { changed: false, reason: now.reason } };
}
