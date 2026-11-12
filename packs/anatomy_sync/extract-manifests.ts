// The manifests' extractor: every pack.json and bundle.json, and packs/roots.json, as the anatomy pack models them.
// A pack, what it declares (types, link types, parts, stores), the names it asks for and offers and who provides each,
// its services' shapes, its place among the roots, and its bundle. The modules it names (a service's or a hook's code)
// are the code extractor's: this one only ties to them.

import { gist, title, type Extractor, type Model, type Source, type Want, type WantLink } from './model.ts';

type Json = Record<string, any>;
interface PackFile { m: Json; home: Source['repo']; path: string; blob: string; rootOrder?: number }

const RUNS = ['actions', 'handlers', 'layouts', 'uses', 'reach'];
const KERNEL_DRAWN = new Set(['tree', 'screen', 'attention']);
const size = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);
const list = (v: unknown): string[] => [].concat((v ?? []) as never);
export const formOf = (n: string) => (n.includes(':') ? n.split(':')[0] : 'pack');
const svc = (n: string) => (n.startsWith('service:') ? n : `service:${n}`);
const MANIFEST = /^(packs|workspace-packs)\/[^/]+\/(pack|bundle)\.json$/;

/** Its kind on an island map, as packs/loader/kernel/islands.ts reads a file: core, a root, a server's, words or habits. */
export function kindOf({ m, rootOrder }: Pick<PackFile, 'm' | 'rootOrder'>): string {
  if (m.id === 'core') return 'kernel';
  if (rootOrder !== undefined) return 'root';
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

/** The model of a set of manifests: what the island holds of packs, apart from their code. */
export function modelOf(packs: PackFile[], bundles: { b: Json }[], calls: Record<string, string[]>): Model {
  const items: Want[] = [], links: WantLink[] = [];
  const want = (key: string, type: string, name: string, body: unknown, props: Record<string, unknown>) => items.push({ key, type, title: title(name), body: gist(body), props });
  const tie = (type: string, from: string, to: string, props?: Record<string, unknown>) => links.push({ type, from, to, ...(props && { props }) });
  const packIds = new Set(packs.map((p) => p.m.id));
  const typeOwner = new Map<string, string>(), linkOwner = new Map<string, string>(), caps = new Map<string, Set<string>>();
  const names = new Set<string>(), shapes = new Map<string, { takes?: unknown; gives?: unknown }>();
  const moduleOf = (p: PackFile, run: string) => { const file = String(run).split('#')[0]; return file ? `module:${p.path}/${p.m.kernel?.modules ?? ''}${file}` : undefined; };

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
    for (const [n, sig] of Object.entries<any>(k.provides ?? {})) { names.add(svc(n)); shapes.set(svc(n), { takes: sig?.in, gives: sig?.out }); }
    for (const n of Object.keys(k.calls ?? {})) names.add(svc(n));
  }
  for (const act of Object.keys(calls)) names.add(svc(act));

  for (const { b } of bundles) { want(`bundle:${b.id}`, 'anatomy.bundle', b.title || b.id, b.description, { bundle_id: b.id }); for (const pid of b.packs ?? []) tie('part_of', `pack:${pid}`, `bundle:${b.id}`); }
  for (const p of packs) {
    const m = p.m, k = m.kernel ?? {}, me = `pack:${m.id}`;
    want(me, 'anatomy.pack', m.title || m.id, m.description, { pack_id: m.id, kind: kindOf(p), home: p.home, version: m.version ?? '', path: p.path, blob: p.blob, ...(k.trust && { trust: k.trust }), ...(p.rootOrder !== undefined && { root_order: p.rootOrder }) });
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
      for (const r of x.runs ?? []) { const mod = moduleOf(p, r); if (mod) tie('anatomy.kept_in', key, mod); }
    }
    for (const [n, sig] of Object.entries<any>(k.provides ?? {})) { const mod = sig?.run && moduleOf(p, sig.run); if (mod) tie('anatomy.kept_in', `name:${svc(n)}`, mod); }
    const stores: [string, string][] = [...Object.keys(k.tables ?? {}).map((t) => [t, 'table'] as [string, string]), ...(k.memory ? [[String(k.memory), 'memory'] as [string, string]] : [])];
    for (const [id, store] of stores) { const key = `store:${m.id}:${id}`; want(key, 'anatomy.store', `${store} ${id}`, '', { store_id: id, store }); tie('part_of', key, me); }
  }

  const provider = (n: string): string[] => {
    const f = formOf(n), rest = n.slice(n.indexOf(':') + 1), of = rest.split('@')[1];
    if (f === 'pack') return packIds.has(n) ? [n] : [];
    if (f === 'type') return [typeOwner.get(rest) ?? linkOwner.get(rest)].filter((x): x is string => !!x);
    if (f === 'has') return [...(caps.get(rest) ?? [])];
    if (f === 'service') return packs.filter((p) => Object.hasOwn(p.m.kernel?.provides ?? {}, rest)).map((p) => p.m.id);
    if (f === 'event') return ['item.due', 'notification.made'].includes(rest) ? ['core'] : packs.filter((p) => (p.m.handlers ?? []).some((h: Json) => list(h.records).includes(rest))).map((p) => p.m.id);
    return of && typeOwner.has(of) ? [typeOwner.get(of)!] : [];
  };
  const json = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v));
  for (const n of [...names].sort()) {
    const shape = shapes.get(n);
    want(`name:${n}`, 'anatomy.name', n, '', { name: n, form: formOf(n), ...(shape?.takes !== undefined && { takes: json(shape.takes) }), ...(shape?.gives !== undefined && { gives: json(shape.gives) }) });
    for (const pid of provider(n)) tie('anatomy.provides', `pack:${pid}`, `name:${n}`);
  }
  for (const [act, callers] of Object.entries(calls)) for (const c of callers) tie('anatomy.calls', `pack:${c}`, `name:${svc(act)}`);
  return { items, links };
}

export const manifests: Extractor = {
  id: 'manifests',
  owns: (path) => MANIFEST.test(path) || path === 'packs/roots.json',
  extract(files) {
    const roots = files.find((f) => f.path === 'packs/roots.json' && f.repo === 'open_core');
    const parsed = roots ? JSON.parse(roots.text) : { roots: [], calls: {} };
    const order = new Map<string, number>(parsed.roots.map((r: { id: string }, i: number) => [r.id, i + 1]));
    const packs: PackFile[] = [], bundles: { b: Json }[] = [];
    for (const f of files) {
      if (!MANIFEST.test(f.path)) continue;
      const m = JSON.parse(f.text);
      if (f.path.endsWith('bundle.json')) bundles.push({ b: m });
      else packs.push({ m, home: f.repo, path: f.path.replace(/\/pack\.json$/, ''), blob: f.blob, rootOrder: order.get(m.id) });
    }
    return modelOf(packs, bundles, parsed.calls ?? {});
  },
};
