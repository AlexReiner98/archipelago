// The in-process tier (docs/kernel-packs.md, "The in-process context"): a root or service pack's code runs in the
// server's process, each of its functions handed one KernelContext and nothing else. A pack's module imports types
// alone (`import type { KernelContext } from '#pelago/kernel'`); what it reads, calls, changes and records goes through
// the context, held to what its manifest declares: the service names it requires or uses, the streams its rules keep,
// the secrets and hosts of its reach. Its changes go through `change` and the rules like any other: nothing here
// decides one.
//
// The plain tier is the sandbox's (src/packhost.ts): a pack with no `kernel` never runs here, and one with `kernel`
// never runs there. Which packs may carry `kernel` at all is the registry's (kernelRefused, src/manifest.ts).

import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isInternal, type Manifest, type ModuleRef } from './manifest.ts';
import { answerRead, type Read } from './packreads.ts';
import { guardedFetch } from './outbound.ts';
import { callService, fillServices } from './services.ts'; import { fillWritePoints, type WriteSlot } from './write-hooks.ts';
import type { Archipelago } from './pelago.ts';
import type { ChangeInput } from './pelago-types.ts';
import type { Fact } from './log.ts';
import type { Registry } from './packs.ts';
import type { OpFact, OpStream } from './streams.ts';

/** On whose authority a service pack's change is made: its own, kept apart from a human's and an agent's. */
export interface SystemAuthority { of: 'system'; basis: string }

/** What a service pack sends to change: a change as anyone sends one, on the pack's own authority. */
export type SystemChange = Omit<ChangeInput, 'authority' | 'pack' | 'hold' | 'drawing' | 'run'> & { basis?: string };

/** What the registry tells a pack: read only. */
export type RegistryRead = Readonly<Pick<Registry, 'types' | 'relations' | 'rules' | 'packs' | 'trees' | 'type' | 'isA' | 'family' | 'relationFamily' | 'ancestry' | 'having' | 'capacity'>>;

/** The one thing a kernel pack's function is handed (docs/kernel-packs.md). */
export interface KernelContext {
  pack: { id: string; version: string; hash: string };
  workspace: string;
  /** The reads a sandboxed pack has (src/packreads.ts), answered in-process under row-level security. */
  reads: (read: Read) => Promise<unknown>;
  registry: RegistryRead;
  /** A service name this pack requires or uses, answered by the one active pack that provides it. */
  call<I, O>(name: string, input: I): Promise<O>;
  /** A change, as `system:<pack>` on its own authority, through the rules. */
  change(input: SystemChange): Promise<Awaited<ReturnType<Archipelago['change']>>>;
  /**
   * A migration of what the pack keeps, run as a workspace opens: the facts it planned, appended in one transaction as
   * the system's move (Archipelago.moved), as the kernel's own migrations are: what moved, and nothing else, with no rule
   * asked. Never a change someone makes: that is `change`.
   */
  move(action: string, reason: string, facts: Fact[]): Promise<void>;
  /** Facts on an operational stream, only one its pack's rules keep. */
  record(stream: string, facts: OpFact[]): Promise<void>;
  /** A secret its reach names, only. */
  secret(key: string): Promise<string | undefined>;
  /** A call out to a host its reach names, only, through the walls (src/outbound.ts). */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  now(): Date;
  /** Said on the server's error stream, named with its pack. */
  said(message: string): void;
}

/** The actor a service pack's change is made as, and its authority. */
export const systemActor = (pack: string) => `system:${pack}`;
export const systemAuthority = (pack: string, basis?: string): SystemAuthority => ({ of: 'system', basis: basis?.trim() || `the ${pack} pack` });

type Fn = (ctx: KernelContext, ...args: unknown[]) => unknown;
export type Filling = { pack: string; ref: ModuleRef; run: (...args: unknown[]) => Promise<unknown> };

/** The internal packs' code of one workspace: their modules, loaded once, and a context for each of their calls. */
export class KernelHost {
  private readonly folderOf: (pack: string) => string;
  private readonly modules = new Map<string, Promise<Record<string, unknown>>>();

  constructor(folderOf: (pack: string) => string) {
    this.folderOf = folderOf;
  }

  /** The active internal packs, in pack order. */
  packs(l: Pick<Archipelago, 'registry'>): Manifest[] {
    return l.registry.packs.filter(isInternal);
  }

  /** A function of a pack's modules, by its `<file>.ts#<export>`: never a file outside its modules folder. */
  async fn(pack: Manifest, ref: ModuleRef): Promise<Fn> {
    const [file, name] = ref.split('#');
    const dir = resolve(this.folderOf(pack.id), pack.kernel?.modules ?? 'kernel/');
    const path = resolve(dir, file);
    const inside = relative(dir, path);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error(`The ${pack.id} pack names ${ref}, outside its modules`);
    if (!this.modules.has(path)) this.modules.set(path, import(pathToFileURL(path).href) as Promise<Record<string, unknown>>);
    const f = (await this.modules.get(path)!)[name];
    if (typeof f !== 'function') throw new Error(`The ${pack.id} pack names ${ref}, which ${join(pack.kernel?.modules ?? 'kernel/', file)} does not export as a function`);
    return f as Fn;
  }

  /** What fills a hook point or slot, in pack order and each pack's own order: each called with its pack's context. */
  async fillings(l: Archipelago, point: string): Promise<Filling[]> {
    const out: Filling[] = [];
    for (const pack of this.packs(l)) {
      for (const ref of [pack.kernel?.hooks?.[point] ?? []].flat()) {
        const f = await this.fn(pack, ref);
        out.push({ pack: pack.id, ref, run: async (...args) => f(contextFor(l, pack, this), ...args) });
      }
    }
    return out;
  }

  /** Each service name the active internal packs provide, bound to its provider's context: what the loader hands fillServices (src/services.ts). */
  services(l: Archipelago): Map<string, (input: unknown) => Promise<unknown>> {
    return new Map(this.packs(l).flatMap((pack) => Object.entries(pack.kernel?.provides ?? {}).map(([name, p]) => [name, async (input: unknown) => (await this.fn(pack, p.run))(contextFor(l, pack, this), input)] as const)));
  }

  /** A service name called by a pack: only one it requires or uses, answered by its one active provider. */
  async call<O>(l: Archipelago, from: Manifest, name: string, input: unknown): Promise<O> {
    const want = `service:${name}`;
    if (![...(from.requires ?? []), ...(from.uses ?? [])].includes(want)) throw new Error(`The ${from.id} pack calls ${want}, which it neither requires nor uses`);
    return this.answer<O>(l, name, input);
  }

  /**
   * A service name answered as the map that asks it: its provider handed a context of that map, so it reads as the
   * asker under row-level security (a person's view, `l.as(viewer)`), never as the map the names were filled for.
   * Only an internal pack's name is answered here; any other is what fillServices was handed.
   */
  async answer<O>(l: Archipelago, name: string, input: unknown): Promise<O> {
    const pack = this.packs(l).find((p) => p.kernel?.provides?.[name]);
    if (!pack) return callService<O>(l.registry, name, input);
    return (await (await this.fn(pack, pack.kernel!.provides![name].run))(contextFor(l, pack, this), input)) as O;
  }

  /** The clocks the internal packs declare, each ready to fire with its pack's context: started by whoever leads. */
  timers(l: Archipelago): { pack: string; every_ms: number; leading: boolean; fire: () => Promise<unknown> }[] {
    return this.packs(l).flatMap((pack) => (pack.kernel?.timers ?? []).map((t) => ({
      pack: pack.id, every_ms: t.every_ms, leading: !!t.leading,
      fire: async () => (await this.fn(pack, t.run))(contextFor(l, pack, this)),
    })));
  }
}

/** The kernel host of each opened workspace's registry. */
const hosts = new WeakMap<object, KernelHost>();

/** At a workspace's open: a host for its internal packs, and their service names filled (src/services.ts). Internal packs are never turned off, so what they provide holds until the server restarts. */
export function openKernel(l: Archipelago): KernelHost {
  const host = new KernelHost((p) => l.registry.folderOf(p));
  hosts.set(l.registry, host);
  fillServices(l.registry, host.services(l));
  // The write path's hook points (src/write-hooks.ts): what the internal packs fill, and a change made as one of them.
  fillWritePoints(l.registry, {
    fillings: (map, point) => host.fillings(map, point),
    change: (map, pack, input) => contextFor(map, map.registry.packs.find((p) => p.id === pack)!, host).change(input),
  });
  return host;
}

/** The kernel host opened for a workspace's registry, if it was. */
export const hostOf = (l: Pick<Archipelago, 'registry'>): KernelHost | undefined => hosts.get(l.registry);

/** Hosts for a registry no workspace opened (a test's map, a registry read at a past version): code only, nothing filled. */
const loose = new WeakMap<object, KernelHost>();
const hostFor = (l: Archipelago): KernelHost => {
  const host = hostOf(l) ?? loose.get(l.registry) ?? new KernelHost((p) => l.registry.folderOf(p));
  if (!hostOf(l)) loose.set(l.registry, host);
  return host;
};

/** The write path's slot for a map no workspace opened (src/write-hooks.ts): its internal packs' fillings, from a loose host. */
export const looseWriteSlot: WriteSlot = {
  fillings: (map, point) => hostFor(map).fillings(map, point),
  change: (map, pack, input) => kernelContext(map, pack).change(input),
};

/** A service name, answered as the map that asks it (KernelHost.answer): what a kernel caller uses, a lens preset's answer among them. */
export const callAs = <O = unknown>(l: Archipelago, name: string, input: unknown): Promise<O> => hostFor(l).answer<O>(l, name, input);

/**
 * The context of one internal pack for a map, as its own calls get it: what the shim at a moved module's old path
 * (docs/kernel-packs.md, "Moving a service in the wave") hands the pack's function, so a caller passing the map keeps
 * working until the gather step rewrites it.
 */
export function kernelContext(l: Archipelago, pack: string): KernelContext {
  const manifest = l.registry.packs.find((p) => p.id === pack && isInternal(p));
  if (!manifest) throw new Error(`No internal pack "${pack}" is loaded here`);
  return contextFor(l, manifest, hostFor(l));
}

/**
 * The context one internal pack's call is handed. Every reach is checked against its manifest when it is used, so a
 * pack that asks for what it did not declare is refused by name, never quietly given less.
 */
export function contextFor(l: Archipelago, pack: Manifest, host: KernelHost): KernelContext {
  const id = pack.id;
  const refuse = (what: string): never => { throw new Error(`The ${id} pack ${what}`); };
  return {
    pack: { id, version: pack.version, hash: l.registry.hashes.get(id) ?? '' },
    workspace: l.workspace,
    reads: (read) => answerRead(l, read),
    registry: l.registry,
    call: <I, O>(name: string, input: I) => host.call<O>(l, pack, name, input),
    change: ({ basis, ...input }) => {
      const authority = systemAuthority(id, basis);
      // Until the actor kind `system` and core's rule system_reach are in the rules (wave 2), a service pack's change is
      // made as an agent named for the pack, kept to its reach by core's pack_reach, its authority said in the basis.
      return l.change({ kind: 'agent', name: systemActor(id) }, { ...input, pack: id, authority: { of: 'agent', basis: `${authority.of}: ${authority.basis}` } });
    },
    move: (action, reason, facts) => l.db.transaction((tx) => l.moved(tx, action, reason, facts)),
    record: async (stream, facts) => {
      if (!l.registry.rules.some((r) => r.pack === id && r.stream === stream)) refuse(`records on "${stream}", a stream none of its rules keeps`);
      await l.record(stream as OpStream, systemActor(id), facts);
    },
    secret: async (key) => {
      const s = (pack.reach?.secrets ?? []).find((x) => x.name === key) ?? refuse(`asks for the secret "${key}", which its reach does not name`);
      return (await l.secret(key)) ?? (s.env ? process.env[s.env] : undefined);
    },
    fetch: (url, init) => {
      const to = new URL(url);
      const host = (pack.reach?.hosts ?? []).find((h) => { const base = new URL(h.base); return base.origin === to.origin && to.pathname.startsWith(base.pathname); });
      if (!host) refuse(`calls ${to.origin}, a host its reach does not name`);
      return guardedFetch(to, init);
    },
    now: () => new Date(),
    said: (message) => console.error(`${id}: ${message}`),
  };
}
