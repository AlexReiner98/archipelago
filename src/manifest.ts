// The pack manifest (Rule 8 of the target model): what a pack declares, in one small shape. A pack declares its
// types, links, rules, views, actions, handlers (code run on an event, a schedule or a webhook), drawings and styles,
// the reach it asks for (hosts, secrets, webhooks, what it reads through, the map's tools its model runs may offer,
// and server reach), and what it requires and what it uses if present. A server pack is a pack that asks for server
// reach: no other kind of pack.
//
// The keys pack files used before this shape are read for one release with a warning, each as LEGACY says, then
// refused. `parts` is how the kernel reads a pack: each thing it declares as one list, whichever shape it came in.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActionDef, DrawingDef, HearDef, HostDef, ReasonDef, ScheduleDef, ScreenDef, StyleDef, TreeDef, VerbDef, ViaDef, ViewDef, WebhookDef } from './declared.ts';
import type { FieldDef, RelationDef, TypeDef } from './packs.ts';
import type { RuleDef } from './rules.ts';
import type { ServerHost, ServerReach } from './server-packs.ts';

/** Fields a pack adds to a type another pack declares: an entry of its types with `of` in place of an id. */
export interface TypeAdd {
  of: string;
  fields: Record<string, FieldDef>;
}

/** A view: a read (today's ViewDef), a tree over "is part of", a screen on the page of items of a kind or type, or a reason attention gives. */
export type ViewEntry = (ViewDef & { form?: undefined }) | (TreeDef & { form: 'tree' }) | (ScreenDef & { form: 'screen' }) | (ReasonDef & { form: 'attention' });

/** An action, or one of the kernel's six verbs (core's own, with no input and no handler). */
export type ActionEntry = ActionDef | (VerbDef & { kernel: true });

/** Code a pack's handler runs by itself: on an event another pack records, on a schedule, or on a webhook's delivery. */
export type HandlerDef =
  | { event: string; limit_ms?: number }
  | { schedule: string; every_minutes?: number; at_start?: boolean; limit_ms?: number }
  | { webhook: string; records?: string[]; limit_ms?: number };

/** What a pack may reach beyond its own map. */
export interface ReachDef {
  hosts?: (HostDef & Partial<ServerHost>)[];
  secrets?: { name: string; env?: string }[];
  webhooks?: (WebhookDef & { format?: 'prefixed' | 'hex'; limit_ms?: number })[];
  /** Server packs' hosts it reads through, as its workspace's connection to that pack. */
  via?: ViaDef[];
  /** The map's tools a model run it asks for may offer the model. */
  runs?: string[];
  /** Server reach: a pack that asks for it is the server's, never a workspace's. */
  server?: ServerReach;
}

export interface Manifest {
  id: string;
  version: string;
  title: string;
  description?: string;
  /** Packs it cannot work without: while one is not active, it waits. */
  requires?: string[];
  /** Packs it works with when they are active: what of it names their types is registered only while they are. */
  uses?: string[];
  types?: (TypeDef | TypeAdd)[];
  links?: RelationDef[];
  rules?: RuleDef[];
  views?: ViewEntry[];
  actions?: ActionEntry[];
  handlers?: HandlerDef[];
  drawings?: DrawingDef[];
  styles?: StyleDef[];
  reach?: ReachDef;
}

/** The keys of a manifest, and of its reach. */
export const MANIFEST_KEYS = ['id', 'version', 'title', 'description', 'requires', 'uses', 'types', 'links', 'rules', 'views', 'actions', 'handlers', 'drawings', 'styles', 'reach'] as const;
export const REACH_KEYS = ['hosts', 'secrets', 'webhooks', 'via', 'runs', 'server'] as const;
export const SERVER_KEYS = ['acts', 'entries', 'pages', 'connect', 'aliases', 'agreements'] as const;

/** Every key pack files used before the manifest, and where it went (docs/packs.md has the table). */
export const LEGACY: Record<string, string> = {
  relations: 'links',
  extend: 'types (an entry { of, fields })',
  trees: 'views (form "tree")',
  screens: 'views (form "screen")',
  verbs: 'actions (kernel: true)',
  schedules: 'handlers ({ schedule })',
  hears: 'handlers ({ event })',
  events: 'handlers ({ webhook, records })',
  hosts: 'reach.hosts',
  secrets: 'reach.secrets',
  webhooks: 'reach.webhooks',
  via: 'reach.via',
  runs: 'reach.runs',
  tier: 'reach.server (a server pack is a pack that asks for server reach)',
  acts: 'reach.server.acts',
  entries: 'reach.server.entries',
  pages: 'reach.server.pages',
  connect: 'reach.server.connect',
  aliases: 'reach.server.aliases',
  agreements: 'reach.server.agreements',
  contract: 'nothing: no part of the kernel reads it',
};

/** The release whose packs may still use the old keys; the next one refuses them. */
export const LEGACY_UNTIL = '0.1.0';
const RELEASE = (JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;
const after = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

type Raw = Record<string, unknown>;
const arr = <T>(x: unknown) => (Array.isArray(x) ? (x as T[]) : []);

/** A pack file in the shape before the manifest, put in the manifest's shape. */
function fromLegacy(raw: Raw): Raw {
  const out: Raw = {};
  const reach: Raw = { ...(raw.reach as Raw | undefined) };
  const server: Raw = { ...(reach.server as Raw | undefined) };
  const push = (key: string, ...items: unknown[]) => (out[key] = [...arr(out[key]), ...items]);
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in LEGACY)) out[key] = value;
  }
  if (raw.relations) push('links', ...arr(raw.relations));
  for (const [of, add] of Object.entries((raw.extend as Record<string, { fields: Raw }> | undefined) ?? {})) push('types', { of, fields: add.fields });
  push('views', ...arr<Raw>(raw.trees).map((t) => ({ form: 'tree', ...t })), ...arr<Raw>(raw.screens).map((s) => ({ form: 'screen', ...s })));
  if (raw.verbs) out.actions = [...arr<Raw>(raw.verbs).map((v) => ({ ...v, kernel: true })), ...arr(out.actions)];
  push('handlers', ...arr<Raw>(raw.schedules).map(({ id, ...rest }) => ({ schedule: id, ...rest })), ...arr<Raw>(raw.hears).map((h) => ({ ...h })));
  if (raw.events) {
    const hook = arr<{ id: string }>(raw.webhooks)[0];
    push('handlers', hook ? { webhook: hook.id, records: raw.events } : { webhook: '', records: raw.events });
  }
  for (const key of ['hosts', 'secrets', 'webhooks', 'via', 'runs']) if (raw[key] !== undefined) reach[key] = raw[key];
  for (const key of SERVER_KEYS) if (raw[key] !== undefined) server[key] = raw[key];
  if (raw.tier === 'server' || Object.keys(server).length) reach.server = server;
  if (Object.keys(reach).length) out.reach = reach;
  for (const key of ['views', 'handlers']) if (!arr(out[key]).length) delete out[key];
  return out;
}

/** Problems with a manifest's own keys, as sentences. */
function keyProblems(m: Raw): string[] {
  const problems: string[] = [];
  const allowed = (where: string, given: Raw | undefined, keys: readonly string[]) => {
    for (const key of Object.keys(given ?? {})) if (!keys.includes(key)) problems.push(`"${where}${key}" is not a key of a manifest: ${where ? `in ${where.slice(0, -1)}, ` : ''}one of ${keys.join(', ')}`);
  };
  allowed('', m, MANIFEST_KEYS);
  const reach = m.reach as Raw | undefined;
  if (reach !== undefined && (typeof reach !== 'object' || Array.isArray(reach))) problems.push('reach is an object');
  allowed('reach.', reach, REACH_KEYS);
  allowed('reach.server.', reach?.server as Raw | undefined, SERVER_KEYS);
  for (const h of arr<Raw>(m.handlers)) {
    const on = ['event', 'schedule', 'webhook'].filter((k) => typeof h[k] === 'string' && h[k]);
    if (on.length !== 1) problems.push(`a handler runs on one of an event, a schedule or a webhook, named: ${JSON.stringify(h)}`);
    if (h.records !== undefined && !h.webhook) problems.push('only a webhook\'s handler says what it records');
  }
  for (const v of arr<Raw>(m.views)) if (v.form !== undefined && v.form !== 'tree' && v.form !== 'screen' && v.form !== 'attention') problems.push(`view "${String(v.id)}": form is tree, screen or attention, or left out for a read`);
  for (const t of arr<Raw>(m.types)) if (t.of !== undefined && (t.id !== undefined || typeof t.fields !== 'object')) problems.push(`type entry of "${String(t.of)}" adds fields to another pack's type: of and fields only`);
  return problems;
}

/**
 * Read a pack file: the manifest, and what to warn of. A key of the shape before is read as LEGACY says, with a
 * warning, until the release after LEGACY_UNTIL; then it is refused, as any key that is not the manifest's is.
 */
export function readManifest(text: string, where: string, release = RELEASE): { manifest: Manifest; warnings: string[] } {
  const raw = JSON.parse(text) as Raw;
  const old = Object.keys(raw).filter((k) => k in LEGACY);
  const id = String(raw.id ?? where);
  if (old.length && after(release, LEGACY_UNTIL)) throw new Error(`Pack "${id}" (${where}) uses keys of the shape before the manifest, refused since ${LEGACY_UNTIL}: ${old.map((k) => `${k} is ${LEGACY[k]}`).join('; ')}`);
  const manifest = old.length ? fromLegacy(raw) : raw;
  const problems = keyProblems(manifest);
  if (problems.length) throw new Error(`Pack "${id}" (${where}): ${problems.join('; ')}`);
  const warnings = old.map((k) => `Pack "${id}" (${where}): "${k}" is read as ${LEGACY[k]} until the release after ${LEGACY_UNTIL}; move it.`);
  return { manifest: manifest as unknown as Manifest, warnings };
}

/** Each thing a pack declares, as one list the kernel reads: what `parts` answers. */
export interface Parts {
  types: TypeDef[];
  adds: Record<string, { fields: Record<string, FieldDef> }>;
  relations: RelationDef[];
  views: ViewDef[];
  trees: TreeDef[];
  screens: ScreenDef[];
  reasons: ReasonDef[];
  verbs: VerbDef[];
  actions: ActionDef[];
  schedules: ScheduleDef[];
  hears: HearDef[];
  events: string[];
  hosts: (HostDef & Partial<ServerHost>)[];
  secrets: { name: string; env?: string }[];
  webhooks: NonNullable<ReachDef['webhooks']>;
  via: ViaDef[];
  runs: string[] | undefined;
  server: ServerReach | undefined;
}

const cache = new WeakMap<Manifest, Parts>();

/** What a pack declares, each kind of thing as a list. Read once per manifest. */
export function parts(m: Manifest): Parts {
  const known = cache.get(m);
  if (known) return known;
  const types = m.types ?? [];
  const views = m.views ?? [];
  const actions = m.actions ?? [];
  const handlers = m.handlers ?? [];
  const adds: Parts['adds'] = {};
  for (const t of types) if ('of' in t) adds[t.of] = { fields: { ...adds[t.of]?.fields, ...t.fields } };
  const strip = <T extends { form?: unknown }>({ form: _f, ...rest }: T) => rest;
  const out: Parts = {
    types: types.filter((t): t is TypeDef => !('of' in t)),
    adds,
    relations: m.links ?? [],
    views: views.filter((v): v is ViewDef & { form?: undefined } => v.form === undefined),
    trees: views.filter((v): v is TreeDef & { form: 'tree' } => v.form === 'tree').map(strip),
    screens: views.filter((v): v is ScreenDef & { form: 'screen' } => v.form === 'screen').map(strip),
    reasons: views.filter((v): v is ReasonDef & { form: 'attention' } => v.form === 'attention').map(strip),
    verbs: actions.filter((a): a is VerbDef & { kernel: true } => 'kernel' in a && a.kernel).map(({ kernel: _k, ...v }) => v),
    actions: actions.filter((a): a is ActionDef => !('kernel' in a && a.kernel)),
    schedules: handlers.flatMap((h) => ('schedule' in h ? [{ id: h.schedule, every_minutes: h.every_minutes, at_start: h.at_start, limit_ms: h.limit_ms }] : [])),
    hears: handlers.flatMap((h) => ('event' in h ? [{ event: h.event, limit_ms: h.limit_ms }] : [])),
    events: handlers.flatMap((h) => ('webhook' in h ? (h.records ?? []) : [])),
    hosts: m.reach?.hosts ?? [],
    secrets: m.reach?.secrets ?? [],
    webhooks: m.reach?.webhooks ?? [],
    via: m.reach?.via ?? [],
    runs: m.reach?.runs,
    server: m.reach?.server,
  };
  cache.set(m, out);
  return out;
}

/** Whether a pack is the server's: it asks for server reach. */
export const isServerPack = (m: Pick<Manifest, 'reach'>) => m.reach?.server !== undefined;

/**
 * A pack as it registers while some pack it uses is not active: what names that pack's types or links is left out
 * (fields added to its types, links to them, screens, trees, actions, styles and rules on them), and the rest stays.
 * The manifest itself when nothing it uses is absent.
 */
export function withoutAbsent(m: Manifest, active: (pack: string) => boolean, declaredBy: (name: string) => string | undefined = () => undefined): Manifest {
  const absent = (m.uses ?? []).filter((u) => !active(u));
  if (!absent.length) return m;
  // A type or link type is named by what it is, so the pack that declares it says whose it is; a tree or view, its name.
  const gone = (name: string) => absent.some((u) => declaredBy(name) === u || name.startsWith(`${u}.`));
  const keep = (names: string[] | undefined) => names?.filter((n) => !gone(n));
  // A list that named only what is gone leaves its registration with nothing to be on: it is left out too.
  const emptied = (before: string[] | undefined, after: string[] | undefined) => Boolean(before?.length) && !after?.length;
  const types = (m.types ?? []).filter((t) => !('of' in t) || !gone(t.of));
  const links = (m.links ?? []).flatMap((r) => {
    const from = keep(r.from)!, to = keep(r.to)!;
    return emptied(r.from, from) || emptied(r.to, to) ? [] : [{ ...r, from, to }];
  });
  const views = (m.views ?? []).flatMap((v): ViewEntry[] => {
    if (v.form === 'screen') {
      const on = keep(v.on);
      return emptied(v.on, on) && !v.nav && !v.at ? [] : [{ ...v, on }];
    }
    if (v.form === 'tree') return [...v.roots, ...v.branches, ...v.work].some(gone) ? [] : [v];
    if (v.form === 'attention') return gone(v.of) ? [] : [v];
    return [v];
  });
  const actions = (m.actions ?? []).flatMap((a): ActionEntry[] => {
    if ('kernel' in a) return [a];
    const on = keep(a.on);
    return emptied(a.on, on) ? [] : [{ ...a, on }];
  });
  const styles = (m.styles ?? []).flatMap((s) => {
    const on = keep(s.on);
    return emptied(s.on, on) ? [] : [{ ...s, on }];
  });
  const named = (x: string | string[] | undefined) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
  const rules = (m.rules ?? []).filter((r) => ![...named(r.when?.type), ...named(r.when?.kind), ...named(r.type)].some(gone));
  return { ...m, types, links, views, actions, styles, rules };
}
