// What is undermined: open work that assumes a hypothesis the evidence has refuted. Each row is the work, named with
// the belief it rests on, so the person sees both at a glance and opens the work.

export async function undermined(ctx) {
  const rows = [];
  const seen = new Set();
  for (const h of await ctx.read({ items: { type: 'inquiry.hypothesis', status: 'refuted' }, fields: [] })) {
    for (const e of await ctx.read({ related: h.id, relation: 'inquiry.assumes', direction: 'in', fields: [] })) {
      if (!e.is_open || seen.has(e.id)) continue;
      seen.add(e.id);
      rows.push({ id: e.id, type: e.type, title: `${e.title} · assumes ${h.title}`, status: e.status });
    }
  }
  return rows;
}
