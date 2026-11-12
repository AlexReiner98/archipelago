// The pack architecture as the anatomy pack models it, read from manifests alone: what items and links the Pack
// anatomy island should hold. Pure: manifests in, items and links out, each keyed so a refresh finds what it made
// before (scripts/anatomy.ts reads the map, compares and sends the difference).

type Json = Record<string, any>;
export interface PackFile { m: Json; home: 'open_core' | 'hosted'; path: string; root: boolean }
export interface Bundle { id: string; title?: string; description?: string; packs?: string[] }
export interface Want { key: string; type: string; title: string; body: string; props: Record<string, unknown> }
export interface WantLink { type: string; from: string; to: string; props?: Record<string, unknown> }
export interface Model { items: Want[]; links: WantLink[] }

/** The link types this model makes: a refresh may take back one of these that it no longer wants, and no other. */
export const MADE_LINKS = ['part_of', 'anatomy.requires', 'anatomy.uses', 'anatomy.provides', 'anatomy.calls', 'anatomy.grants', 'anatomy.extends', 'anatomy.joins', 'anatomy.hears', 'anatomy.records', 'anatomy.moved_from', 'anatomy.kept_in'];

const RUNS = ['actions', 'handlers', 'layouts', 'uses', 'reach'];
const KERNEL_DRAWN = new Set(['tree', 'screen', 'attention']);
const size = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const gist = (s: unknown) => cut(String(s ?? '').split(/(?<=\.)\s/).slice(0, 2).join(' '), 400);
const list = (v: unknown): string[] => [].concat((v ?? []) as never);
export const formOf = (n: string) => (n.includes(':') ? n.split(':')[0] : 'pack');
const svc = (n: string) => (n.startsWith('service:') ? n : `service:${n}`);

/** Its kind on an island map, as packs/loader/kernel/islands.ts reads a file: core, a root, a server's, words or habits. */
export function kindOf({ m, root }: PackFile): string {
  if (m.id === 'core') return 'kernel';
  if (root) return 'root';
  if (m.reach?.server) return 'server';
  const runs = RUNS.some((k) => size(m[k])) || list(m.requires).some((r) => !/^(has|type):/.test(r) && r !== 'core');
  return (size(m.types) || size(m.links)) && !runs ? 'island' : 'map';
}

interface Part { part: string; id: string; title: string; side: 'words' | 'habits'; rec: Json; runs?: string[] }
/** Everything a pack declares beside its types and link types. */
export function partsOf(m: Json): Part[] {
  const out: Part[] = [];
  for (const r of m.rules ?? []) out.push({ part: 'rule', id: r.id, title: r.id, side: 'words', rec: r });
  for (const v of m.views ?? []) out.push({ part: 'view', id: v.id, title: v.title || v.id, side: KERNEL_DRAWN.has(v.form) ? 'words' : 'habits', rec: v });
  for (const a of m.actions ?? []) out.push({ part: 'action', id: a.id ?? a.name, title: a.title || a.id || a.name, side: 'habits', rec: a });
  (m.handlers ?? []).forEach((h: Json, i: number) => out.push({ part: 'handler', id: h.id ?? `${m.id}.handler_${i + 1}`, title: h.title || h.id || (h.event ? `on ${h.event}` : h.schedule ? `every ${h.every_minutes ?? '?'} min` : h.webhook ? `webhook ${h.webhook}` : `handler ${i + 1}`), side: 'habits', rec: h }));
  for (const l of m.layouts ?? []) out.push({ part: 'layout', id: l.id, title: l.title || l.id, side: 'habits', rec: l });
  for (const s of m.styles ?? []) {
    const part = s.type === 'instruction' ? 'instruction' : s.type === 'lens' ? 'lens' : 'style';
    out.push({ part, id: s.id, title: s.title || s.id, side: part === 'style' ? 'habits' : 'words', rec: s });
  }
  const server = m.reach?.server ?? {};
  for (const [k, part] of [['gates', 'gate'], ['mounts', 'mount'], ['launchers', 'launcher'], ['streams', 'stream'], ['files', 'file']]) {
    const v = server[k]; if (!v) continue;
    const ids = Array.isArray(v) ? v.map((x: any, i: number) => (typeof x === 'string' ? x : x.id ?? x.name ?? `${k}_${i + 1}`)) : Object.keys(v);
    for (const id of ids) out.push({ part, id: `${m.id}.${part}.${id}`, title: `${part} ${id}`, side: 'habits', rec: {} });
  }
  if (server.adapter) out.push({ part: 'adapter', id: `${m.id}.adapter`, title: `adapter ${server.adapter.surface ?? ''}`.trim(), side: 'habits', rec: {} });
  if (server.counts) out.push({ part: 'count', id: `${m.id}.counts`, title: `counts ${server.counts}`, side: 'habits', rec: {} });
  const k = m.kernel ?? {};
  for (const [h, v] of Object.entries(k.hooks ?? {})) out.push({ part: 'hook', id: `${m.id}.hook.${h}`, title: `hook ${h}`, side: 'habits', rec: {}, runs: list(v) });
  for (const [t, v] of Object.entries<any>(k.timers ?? {})) out.push({ part: 'handler', id: `${m.id}.timer.${t}`, title: `timer ${t}`, side: 'habits', rec: {}, runs: list(typeof v === 'string' ? v : v?.run) });
  const reach = { ...(m.reach ?? {}) }; delete reach.server;
  for (const key of Object.keys(reach)) if (size(reach[key])) out.push({ part: 'reach', id: `${m.id}.reach.${key}`, title: `reach ${key}`, side: 'habits', rec: {} });
  return out;
}

/** The keys an item of the model has, read back off the map: its type, its fields and the pack it is part of. */
export function keyOf(type: string, props: Json, pack?: string): string | undefined {
  switch (type) {
    case 'anatomy.pack': return props.pack_id && `pack:${props.pack_id}`;
    case 'anatomy.bundle': return props.bundle_id && `bundle:${props.bundle_id}`;
    case 'anatomy.name': return props.name && `name:${props.name}`;
    case 'anatomy.module': return props.path && `module:${props.path}`;
    case 'anatomy.type': return props.type_id && `type:${props.adds_fields ? `${props.type_id}+${pack}` : props.type_id}`;
    case 'anatomy.link_type': return props.link_id && `link:${props.link_id}`;
    case 'anatomy.part': return pack && props.part_id && `part:${pack}:${props.part}:${props.part_id}:${props.side}`;
    default: return undefined;
  }
}

export function model(packs: PackFile[], bundles: Bundle[], calls: Record<string, string[]>): Model {
  const items: Want[] = [], links: WantLink[] = [];
  const want = (key: string, type: string, title: string, body: unknown, props: Record<string, unknown>) => items.push({ key, type, title: cut(title, 60), body: gist(body), props });
  const tie = (type: string, from: string, to: string, props?: Record<string, unknown>) => links.push({ type, from, to, ...(props && { props }) });
  const packIds = new Set(packs.map((p) => p.m.id));
  const typeOwner = new Map<string, string>(), linkOwner = new Map<string, string>(), caps = new Map<string, Set<string>>();
  const names = new Set<string>(), modules = new Map<string, string>(); // path -> pack id
  const modOf = (p: PackFile, run: string) => { const file = String(run).split('#')[0]; if (!file) return undefined; const path = `${p.path}/${p.m.kernel?.modules ?? ''}${file}`; modules.set(path, p.m.id); return `module:${path}`; };

  for (const p of packs) {
    const m = p.m, k = m.kernel ?? {};
    for (const r of [...list(m.requires), ...list(m.uses)]) names.add(r);
    for (const t of m.types ?? []) {
      if (t.of) continue;
      typeOwner.set(t.id, m.id);
      for (const c of Object.keys(t.capabilities ?? {})) { names.add(`has:${c}`); (caps.get(c) ?? caps.set(c, new Set()).get(c)!).add(m.id); }
    }
    for (const l of m.links ?? []) { linkOwner.set(l.id, m.id); for (const e of [...list(l.from), ...list(l.to)]) if (e.startsWith('has:')) names.add(e); }
    for (const h of m.handlers ?? []) { if (h.event) names.add(`event:${h.event}`); for (const r of list(h.records)) names.add(`event:${r}`); }
    for (const n of [...Object.keys(k.provides ?? {}), ...Object.keys(k.calls ?? {})]) names.add(svc(n));
  }
  for (const act of Object.keys(calls)) names.add(svc(act));

  for (const b of bundles) { want(`bundle:${b.id}`, 'anatomy.bundle', b.title || b.id, b.description, { bundle_id: b.id }); for (const pid of b.packs ?? []) tie('part_of', `pack:${pid}`, `bundle:${b.id}`); }
  for (const p of packs) {
    const m = p.m, k = m.kernel ?? {}, me = `pack:${m.id}`;
    want(me, 'anatomy.pack', m.title || m.id, m.description, { pack_id: m.id, kind: kindOf(p), home: p.home, version: m.version ?? '', path: p.path, ...(k.trust && { trust: k.trust }) });
    for (const r of list(m.requires)) tie('anatomy.requires', me, `name:${r}`);
    for (const r of list(m.uses)) tie('anatomy.uses', me, `name:${r}`);
    for (const n of Object.keys(k.calls ?? {})) tie('anatomy.calls', me, `name:${svc(n)}`);
    for (const mf of list(m.moved_from)) if (packIds.has(mf) && mf !== m.id) tie('anatomy.moved_from', me, `pack:${mf}`);
    for (const t of m.types ?? []) {
      const key = `type:${t.of ? `${t.of}+${m.id}` : t.id}`;
      const st = t.statuses ? `${list(t.statuses.open).join(' ')} | ${list(t.statuses.closed).join(' ')}` : '';
      want(key, 'anatomy.type', t.of ? `Fields on ${t.of}` : t.title || t.id, t.description ?? (t.of ? `${m.id} adds ${Object.keys(t.fields ?? {}).join(', ')} to ${t.of}.` : ''), { type_id: t.of ?? t.id, ...(st && { statuses: st }), ...(t.of && { adds_fields: true }) });
      tie('part_of', key, me);
      for (const b of list(t.of ?? t.extends)) tie('anatomy.extends', key, `type:${b}`);
      if (!t.of) for (const c of Object.keys(t.capabilities ?? {})) tie('anatomy.grants', key, `name:has:${c}`);
    }
    for (const l of m.links ?? []) {
      const key = `link:${l.id}`;
      want(key, 'anatomy.link_type', l.title || l.id, l.description, { link_id: l.id, ...(l.root && { root: true }) });
      tie('part_of', key, me);
      for (const b of list(l.extends)) tie('anatomy.extends', key, `link:${b}`);
      for (const [end, ends] of [['from', l.from], ['to', l.to]] as const) for (const e of list(ends)) if (e !== '*') tie('anatomy.joins', key, e.startsWith('has:') ? `name:${e}` : `type:${e}`, { end });
    }
    for (const x of partsOf(m)) {
      const key = `part:${m.id}:${x.part}:${x.id}:${x.side}`;
      want(key, 'anatomy.part', x.title, x.rec.description ?? x.rec.say ?? x.rec.body, { part: x.part, part_id: x.id, side: x.side });
      tie('part_of', key, me);
      if (x.part === 'handler' && x.rec.event) tie('anatomy.hears', key, `name:event:${x.rec.event}`);
      for (const r of list(x.rec.records)) tie('anatomy.records', key, `name:event:${r}`);
      for (const r of x.runs ?? []) { const mod = modOf(p, r); if (mod) tie('anatomy.kept_in', key, mod); }
    }
    for (const [n, sig] of Object.entries<any>(k.provides ?? {})) { const mod = sig?.run && modOf(p, sig.run); if (mod) tie('anatomy.kept_in', `name:${svc(n)}`, mod); }
  }
  for (const [path, pid] of modules) { want(`module:${path}`, 'anatomy.module', path.split('/').pop()!, '', { path }); tie('part_of', `module:${path}`, `pack:${pid}`); }

  const provider = (n: string): string[] => {
    const f = formOf(n), rest = n.slice(n.indexOf(':') + 1), of = rest.split('@')[1];
    if (f === 'pack') return packIds.has(n) ? [n] : [];
    if (f === 'type') return [typeOwner.get(rest) ?? linkOwner.get(rest)].filter((x): x is string => !!x);
    if (f === 'has') return [...(caps.get(rest) ?? [])];
    if (f === 'service') return packs.filter((p) => Object.hasOwn(p.m.kernel?.provides ?? {}, rest)).map((p) => p.m.id);
    if (f === 'event') return ['item.due', 'notification.made'].includes(rest) ? ['core'] : packs.filter((p) => (p.m.handlers ?? []).some((h: Json) => list(h.records).includes(rest))).map((p) => p.m.id);
    return of && typeOwner.has(of) ? [typeOwner.get(of)!] : [];
  };
  for (const n of [...names].sort()) {
    want(`name:${n}`, 'anatomy.name', n, '', { name: n, form: formOf(n) });
    for (const pid of provider(n)) tie('anatomy.provides', `pack:${pid}`, `name:${n}`);
  }
  for (const [act, callers] of Object.entries(calls)) for (const c of callers) tie('anatomy.calls', `pack:${c}`, `name:${svc(act)}`);

  const keys = new Set(items.map((i) => i.key)), seen = new Set<string>();
  return { items, links: links.filter((l) => { const k = `${l.type}|${l.from}|${l.to}`; if (seen.has(k) || l.from === l.to || !keys.has(l.from) || !keys.has(l.to)) return false; seen.add(k); return true; }) };
}
