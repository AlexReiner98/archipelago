// The pack manifest (Rule 8 of the target model): what a pack declares, in one small shape. A pack declares its
// types, links, rules, views, actions, handlers (code run on an event, a schedule or a webhook), drawings and styles,
// the reach it asks for (hosts, secrets, webhooks, what it reads through and server
// reach), and what it requires and what it uses if present. A server pack is a pack that asks for server
// reach: no other kind of pack.
//
// The keys pack files used before this shape are refused, each named with where it went (LEGACY). `parts` is how the kernel reads a pack: each thing it declares as one list, whichever shape it came in.

import type { ActionDef, LayoutDef, HearDef, HostDef, ReasonDef, ScheduleDef, ScreenDef, StyleDef, TreeDef, VerbDef, ViaDef, ViewDef, WebhookDef } from './declared.ts';
import { isName, KERNEL_PACKS, NAME_FORMS } from './packorder.ts';
import type { FieldDef, RelationDef, TypeDef } from './packs.ts';
import type { RuleDef } from '../../../src/rules.ts';
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
  | { event: string; records?: string[]; limit_ms?: number }
  | { schedule: string; every_minutes?: number; at_start?: boolean; limit_ms?: number }
  | { webhook: string; records?: string[]; limit_ms?: number };

/** What a pack may reach beyond its own map. */
export interface ReachDef {
  hosts?: (HostDef & Partial<ServerHost>)[];
  secrets?: { name: string; env?: string }[];
  webhooks?: (WebhookDef & { format?: 'prefixed' | 'hex'; limit_ms?: number })[];
  /** Server packs' hosts it reads through, as its workspace's connection to that pack. */
  via?: ViaDef[];
  /** Server reach: a pack that asks for it is the server's, never a workspace's. */
  server?: ServerReach;
  /** It may answer an action a person calls with sessions to start: true for up to ten in one answer, or a number fewer (src/pack-action-launch.ts). */
  launch?: boolean | number;
}

export interface Manifest {
  id: string;
  version: string;
  title: string;
  description?: string;
  /** Names it cannot work without, each has:<capability>, type:<id> or event:<kind> (src/packorder.ts): while one has no active provider, it waits. A bare pack id is the old form, kept for a bundle's two halves. */
  requires?: string[];
  /** Names it works with while they are provided, as requires names them: what of it names their provider's types is registered only while that one is active. */
  uses?: string[];
  types?: (TypeDef | TypeAdd)[];
  links?: RelationDef[];
  rules?: RuleDef[];
  views?: ViewEntry[];
  actions?: ActionEntry[];
  handlers?: HandlerDef[];
  layouts?: LayoutDef[];
  styles?: StyleDef[];
  reach?: ReachDef;
  /** The shared set every pack on an island map may build on, by type id: the kernel's pack alone declares it (src/islands.ts). */
  shared?: string[];
  /** The packs it took declarations from, keeping their ids (src/pack-moved.ts): it may name a view, a style, a rule, an action or a layout `<pack>.<name>` for each, and is turned on, once, wherever one of them was. The kernel's packs are always among them. */
  moved_from?: string[];
  /** Its tier, and the code it runs in the server's process (docs/kernel-packs.md): only a pack of the server's own folder. */
  kernel?: KernelSpec;
}

/** A pack's tier: root holds control, service runs in-process beside it through the KernelContext (src/kernel-context.ts). */
export type Trust = 'root' | 'service';
/** A function of a pack's modules, `<file>.ts#<export>`, under its `modules` folder. */
export type ModuleRef = string;
/** The manifest key `kernel` (docs/kernel-packs.md, "The manifest key"). */
export interface KernelSpec {
  trust: Trust;
  /** Shipped with the server, versioned with it, its code in-process: every root and service pack is. */
  internal: true;
  /**
   * Whether a map may switch it off on the Packs screen (decision e_cenjpmrf, the owner, 12 Nov 2026). Absent, it is
   * required: always on, never taken out. An optional one is on where the map has it, and honours every reason a plain
   * pack is off; it fills only the write path's points, which are read at each change, so switching it off takes it
   * out at once. Never a root pack.
   */
  optional?: true;
  /** The folder of its code under the pack's own, `kernel/` unless said. */
  modules?: string;
  /** The service names it provides (`<family>.<name>`; a root's are `root.<name>`, src/root-calls.ts), each with its shapes (src/services.ts) and the function that answers it. */
  provides?: Record<string, { in?: unknown; out?: unknown; read?: string; run: ModuleRef }>;
  /** The shapes it calls service names with: what it gives and reads, checked against the provider's (src/packorder.ts). */
  calls?: Record<string, { in?: unknown; out?: unknown }>;
  /** The hook points and slots it fills, each with its function (or several, in order). */
  hooks?: Record<string, ModuleRef | ModuleRef[]>;
  /** The fields of an item its write.rewrite fillings may set (src/write-hooks.ts): none unless said. */
  fills?: string[];
  /** The tables of its own that a log.project filling writes, each a column by its shape. */
  tables?: Record<string, Record<string, string>>;
  /** What it runs on a clock, on the server that leads. */
  timers?: { run: ModuleRef; every_ms: number; leading?: boolean }[];
  /**
   * The settings prefix its memory (the read memory, src/packreads-service.ts) is kept under, in place of
   * `pack:<id>:`: a prefix the code it took over already kept there, so nothing is migrated (decision e_a8dh8fg3).
   */
  memory?: string;
}
export const KERNEL_KEYS: readonly string[] = 'trust internal modules provides calls hooks fills tables timers optional memory'.split(' ');
const MODULE_REF = /^[\w./-]+\.ts#[A-Za-z_$][\w$]*$/;

/** Problems with a manifest's `kernel`, as sentences. Where a pack may carry it is the registry's (kernelRefused). */
export function kernelProblems(k: unknown): string[] {
  if (k === undefined) return [];
  if (typeof k !== 'object' || k === null || Array.isArray(k)) return ['kernel is an object: { trust, internal, modules?, provides?, calls?, hooks?, fills?, tables?, timers?, optional?, memory? }'];
  const s = k as Raw, problems: string[] = [];
  for (const key of Object.keys(s)) if (!(KERNEL_KEYS as readonly string[]).includes(key)) problems.push(`"kernel.${key}" is not a key of a manifest: in kernel, one of ${KERNEL_KEYS.join(', ')}`);
  if (s.trust !== 'root' && s.trust !== 'service') problems.push('kernel.trust is root or service');
  if (s.internal !== true) problems.push('kernel.internal is true: a root or service pack is versioned with the server');
  if (s.modules !== undefined && (typeof s.modules !== 'string' || !/^[\w-]+\/?$/.test(s.modules))) problems.push(`kernel.modules is a folder of the pack's own, such as "kernel/"`);
  const ref = (where: string, r: unknown) => { if (typeof r !== 'string' || !MODULE_REF.test(r) || r.includes('..')) problems.push(`${where} names a function of the pack's modules, <file>.ts#<export>: ${JSON.stringify(r)}`); };
  for (const [name, p] of Object.entries((s.provides ?? {}) as Record<string, Raw>)) ref(`kernel.provides.${name}`, p?.run);
  for (const [point, r] of Object.entries((s.hooks ?? {}) as Record<string, unknown>)) for (const one of [r].flat()) ref(`kernel.hooks.${point}`, one);
  if (s.fills !== undefined && (!Array.isArray(s.fills) || s.fills.some((f) => typeof f !== 'string' || !f))) problems.push('kernel.fills is a list of the fields its rewrite may set');
  for (const [i, t] of arr<Raw>(s.timers).entries()) { ref(`kernel.timers[${i}]`, t.run); if (typeof t.every_ms !== 'number' || t.every_ms < 1000) problems.push(`kernel.timers[${i}].every_ms is a number of milliseconds, 1000 or more`); }
  if (s.trust === 'root' && (s.hooks !== undefined || s.fills !== undefined)) problems.push('a root pack opens hook points and slots; it fills none');
  // The root service family (src/root-calls.ts): a root provides only root.<name>, and only a root provides one.
  for (const name of Object.keys((s.provides ?? {}) as Raw)) if ((s.trust === 'root') !== name.startsWith('root.')) problems.push(s.trust === 'root' ? `kernel.provides "${name}": a root pack provides only root.<name>, a root service` : `kernel.provides "${name}": only a root pack provides a root service`);
  if (s.optional !== undefined && s.optional !== true) problems.push('kernel.optional is true, or absent for a required pack');
  if (s.optional === true && s.trust === 'root') problems.push('a root pack is never optional: it is always on');
  if (s.optional === true) {
    // What is filled once at a workspace's open would outlive the switch: an optional pack declares none of it.
    const held = ['provides', 'tables', 'timers'].filter((k) => s[k] !== undefined);
    const points = Object.keys((s.hooks ?? {}) as Raw).filter((p) => !p.startsWith('write.'));
    if (held.length || points.length) problems.push(`an optional pack fills only the write path's points (write.*), read at each change: not ${[...held.map((k) => `kernel.${k}`), ...points].join(', ')}`);
  }
  if (s.memory !== undefined && (typeof s.memory !== 'string' || !/^[a-z][a-z0-9_]*:$/.test(s.memory) || s.memory.startsWith('pack:'))) problems.push('kernel.memory is a settings prefix of lower-case letters, digits and _, ending in a colon, such as "due_on:", and never pack:');
  if (s.memory !== undefined && s.trust !== 'service') problems.push("kernel.memory is a service pack's");
  return problems;
}

/** A pack's tier: root, service, or none (plain, in the sandbox). */
export const tierOf = (m: Pick<Manifest, 'kernel'>): Trust | undefined => m.kernel?.trust;
/** Whether a pack is the server's own internal one: shipped with the server, versioned with it, in-process. */
export const isInternal = (m: Pick<Manifest, 'kernel'>): boolean => m.kernel?.internal === true;
/** Whether an internal pack is optional: a map may switch it off on the Packs screen (kernel.optional). */
export const isOptional = (m: Pick<Manifest, 'kernel'>): boolean => isInternal(m) && m.kernel?.optional === true;
/** Whether an internal pack is required: always on, never taken out. */
export const isRequired = (m: Pick<Manifest, 'kernel'>): boolean => isInternal(m) && !isOptional(m);
/** The settings prefix a pack's memory is kept under: its declared one (kernel.memory), else its own `pack:<id>:`. */
export const memoryPrefix = (m: Pick<Manifest, 'id' | 'kernel'>): string => m.kernel?.memory ?? `pack:${m.id}:`;

/**
 * The packs that carry `kernel` but are not of the server's own folder (a pack kept as an item, a version, a folder
 * `PELAGO_PACKS` names), each with why: they are refused, and stay off.
 */
export const kernelRefused = (packs: Iterable<Manifest>, own: (id: string) => boolean): [string, string][] =>
  [...packs].filter((p) => p.kernel !== undefined && !own(p.id)).map((p) => [p.id, "carries kernel code, which only the server's own packs may"]);

/** The keys of a manifest, and of its reach. */
export const MANIFEST_KEYS = ['id', 'version', 'title', 'description', 'requires', 'uses', 'types', 'links', 'rules', 'views', 'actions', 'handlers', 'layouts', 'styles', 'reach', 'shared', 'moved_from', 'kernel'] as const;
export const REACH_KEYS = ['hosts', 'secrets', 'webhooks', 'via', 'server', 'launch'] as const;
export const SERVER_KEYS = ['acts', 'entries', 'pages', 'connect', 'aliases', 'gates', 'mounts', 'streams', 'files', 'launchers', 'adapter', 'counts'] as const;

/** Every key pack files used before the manifest, and where it went (docs/packs.md has the table). */
export const LEGACY: Record<string, string> = {
  relations: 'links',
  extend: 'types (an entry { of, fields })',
  trees: 'views (form "tree")',
  screens: 'views (form "screen")',
  verbs: 'actions (kernel: true)',
  schedules: 'handlers ({ schedule })',
  hears: 'handlers ({ event })',
  events: 'handlers ({ webhook, records } or { event, records })',
  hosts: 'reach.hosts',
  secrets: 'reach.secrets',
  webhooks: 'reach.webhooks',
  via: 'reach.via',
  tier: 'reach.server (a server pack is a pack that asks for server reach)',
  acts: 'reach.server.acts',
  entries: 'reach.server.entries',
  pages: 'reach.server.pages',
  connect: 'reach.server.connect',
  aliases: 'reach.server.aliases',
  agreements: 'reach.server.gates.signin (a handler the kernel calls, answering the documents and what an address owes)',
  contract: 'nothing: no part of the kernel reads it',
};

type Raw = Record<string, unknown>;
const arr = <T>(x: unknown) => (Array.isArray(x) ? (x as T[]) : []);

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
    if (h.records !== undefined && h.schedule) problems.push('a schedule\'s handler records nothing: a webhook\'s or an event\'s says what it records');
  }
  for (const v of arr<Raw>(m.views)) if (v.form !== undefined && v.form !== 'tree' && v.form !== 'screen' && v.form !== 'attention') problems.push(`view "${String(v.id)}": form is tree, screen or attention, or left out for a read`);
  if (m.shared !== undefined && (!KERNEL_PACKS.includes(String(m.id)) || !Array.isArray(m.shared) || m.shared.some((t) => typeof t !== 'string'))) problems.push('shared is a list of type ids, and only the kernel\'s pack declares it');
  else if (Array.isArray(m.shared)) { const own = new Set(arr<Raw>(m.types).map((t) => t.id)); const not = m.shared.filter((t) => !own.has(t)); if (not.length) problems.push(`shared names ${not.join(', ')}: the shared set is of the types this pack declares`); }
  if (m.moved_from !== undefined && (!Array.isArray(m.moved_from) || m.moved_from.some((p) => typeof p !== 'string' || !/^[a-z][\w-]*$/.test(p) || p === m.id))) problems.push('moved_from is a list of the ids of the packs it took declarations from, not its own');
  for (const [key, names] of Object.entries({ requires: m.requires, uses: m.uses })) for (const n of arr<unknown>(names)) if (!isName(n)) problems.push(`${key} names ${JSON.stringify(n)}: ${NAME_FORMS}`);
  for (const t of arr<Raw>(m.types)) if (t.of !== undefined && (t.id !== undefined || typeof t.fields !== 'object')) problems.push(`type entry of "${String(t.of)}" adds fields to another pack's type: of and fields only`);
  problems.push(...kernelProblems(m.kernel));
  if (m.kernel !== undefined && (m.handlers !== undefined || (m.reach as Raw | undefined)?.server !== undefined)) problems.push("a kernel pack runs in the server's process: no handlers for the sandbox, and no server reach");
  return problems;
}

/** Read a pack file. A key of the shape before is refused with where it went (LEGACY), as any key that is not the manifest's is. */
export function readManifest(text: string, where: string): Manifest {
  const raw = JSON.parse(text) as Raw;
  const old = Object.keys(raw).filter((k) => k in LEGACY);
  const id = String(raw.id ?? where);
  if (old.length) throw new Error(`Pack "${id}" (${where}) uses keys of the shape before the manifest, refused since 0.1.0: ${old.map((k) => `${k} is ${LEGACY[k]}`).join('; ')}`);
  const problems = keyProblems(raw);
  if (problems.length) throw new Error(`Pack "${id}" (${where}): ${problems.join('; ')}`);
  return raw as unknown as Manifest;
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
    events: handlers.flatMap((h) => ('webhook' in h || 'event' in h ? (h.records ?? []) : [])),
    hosts: m.reach?.hosts ?? [],
    secrets: m.reach?.secrets ?? [],
    webhooks: m.reach?.webhooks ?? [],
    via: m.reach?.via ?? [],
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
  const rules = (m.rules ?? []).filter((r) => ![...named(r.when?.type), ...named(r.type)].some(gone));
  return { ...m, types, links, views, actions, styles, rules };
}
