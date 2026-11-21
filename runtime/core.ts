/**
 * The kernel: a small Cordis runtime (arXiv 2608.25512, §3 and §5.1).
 *
 * - Effects (Algorithm 1). Every change a pack makes goes through
 *   `ctx.effect`, which records its inverse on the pack's fiber. Unloading
 *   the fiber runs the inverses, last first.
 * - Coeffects (Algorithms 2, 3, 6). A pack `provide`s capability keys and
 *   `inject`s the keys it needs. It stays inactive until every key it
 *   injects is provided by an active fiber, and goes inactive again when a
 *   provider leaves. There are no version checks: a key is its meaning.
 * - The lifecycle (Algorithm 5). Load and unload are inertial: a transition
 *   runs to its end, then the fiber compares its target again.
 * - The Caller. A provider is served once per calling context and told who
 *   is calling: the pack, the actor and run from interception, and the
 *   pack's place in the config tree. No call passes identity.
 *
 * Isomorphic: no Node or DOM imports, so the browser runs the same file.
 */
import type { Actor, Caller, Dispose, PackId } from "../spec/common.ts";
import { META, byPosition } from "../spec/common.ts";

/** What a pack module exports (as its default export, or as the module). */
export interface Pack<C = any> {
  /** The pack's id, as its manifest names it. */
  id: PackId;
  /** What it is for, in one plain sentence: what a person reads about it. */
  about?: string;
  /** The capability keys it needs. Until each is provided, it stays inactive. */
  inject?: readonly string[];
  /**
   * Runs when every injected key is provided. Whatever it registers through
   * `ctx` is its effect and goes when it unloads. It may be async, or a
   * generator that yields inverses (Definition 17): the runtime stops
   * iterating if the pack's target changes between steps.
   */
  apply(ctx: Context, config: C): unknown;
}

/**
 * How a capability is provided: called once per calling context with who is
 * calling, and that context, so whatever the consumer registers can be made
 * the consumer's effect (`from.effect`).
 */
export type Serve<T = unknown> = (caller: Caller, from: Context) => T;

/** Interception metadata: `actor` and `run` (META), and anything a pack adds. */
export type Meta = Record<string, unknown>;

export type State = "inactive" | "loading" | "active" | "unloading" | "failed";

/** An inverse: what it returns is ignored, unless a promise, which is awaited. */
type Undo = () => unknown;
/** An inverse, or nothing to undo. */
type Inverse = Undo | void | undefined;
type EffectResult =
  | Inverse
  | Promise<Inverse>
  | Iterator<Inverse, Inverse>
  | AsyncIterator<Inverse, Inverse>;

interface Binding {
  id: number;
  key: string;
  fiber: Fiber;
  serve: Serve;
}

const noop: Dispose = () => {};

function isIterator(v: unknown): v is Iterator<Inverse> | AsyncIterator<Inverse> {
  return !!v && typeof (v as Iterator<unknown>).next === "function" && typeof v === "object";
}
function isPromise(v: unknown): v is Promise<unknown> {
  return !!v && typeof (v as Promise<unknown>).then === "function";
}

/**
 * Whether `p` settles within `ms`. A teardown that hangs must not hold up
 * the rest: the runtime reports it and carries on.
 */
async function within(p: unknown, ms: number): Promise<boolean> {
  if (!isPromise(p)) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((ok) => (timer = setTimeout(() => ok(false), ms)));
  try {
    return await Promise.race([p.then(() => true as const), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs inverses last first, waiting for each that is async. */
async function runAll(inverses: Undo[]): Promise<void> {
  for (let i = inverses.length - 1; i >= 0; i--) await inverses[i]!();
}

/**
 * Algorithm 1's `execute`: drives an effect iterator, folding the inverse
 * yielded at each step. Before each step it consults `guard`; once the
 * guard trips, iteration stops and only the inverses so far remain.
 */
async function execute(result: EffectResult, guard: () => boolean): Promise<Undo[]> {
  const inverses: Undo[] = [];
  if (isIterator(result)) {
    const iter = result;
    try {
      while (guard()) {
        const { value, done } = await iter.next();
        if (typeof value === "function") inverses.push(value);
        if (done) break;
      }
    } catch (e) {
      await runAll(inverses);
      throw e;
    }
    if (!guard()) await iter.return?.();
    return inverses;
  }
  const value = isPromise(result) ? await result : result;
  if (typeof value === "function") inverses.push(value as Undo);
  return inverses;
}

/**
 * A context: the handle a pack works through. Each fiber has one; an
 * intercepted context is a child of it that shares its fiber (its effects
 * are the same pack's) and carries more metadata.
 */
export class Context {
  readonly runtime: Runtime;
  readonly fiber: Fiber;
  /** Metadata for every key, then per key. Read live: updating it needs no reload. */
  meta: { all: Meta; keys: Record<string, Meta> };
  /** Served capabilities, per binding: one serve per calling context. */
  private served = new Map<number, unknown>();

  constructor(runtime: Runtime, fiber: Fiber, meta?: Context["meta"]) {
    this.runtime = runtime;
    this.fiber = fiber;
    this.meta = meta ?? { all: {}, keys: {} };
  }

  /**
   * A revertible effect (Algorithm 1). `callback` makes a change and returns
   * its inverse, or is a generator that yields one inverse per step. The
   * effect belongs to this context's fiber: it is reverted when the fiber
   * unloads, or earlier by the returned Dispose. Calling that twice is
   * harmless.
   */
  effect(callback: () => EffectResult): Dispose {
    const fiber = this.fiber;
    if (!fiber.accepting()) {
      throw new Error(`${fiber.pack.id}: effect on a context that is ${fiber.state}`);
    }
    let armed = true;
    const result = callback();
    let inverses: Undo[] | undefined;
    let task: Promise<Undo[]> | undefined;
    if (isIterator(result) || isPromise(result)) {
      task = execute(result, () => armed);
      // An effect that fails is the caller's error; nothing to undo is kept.
      task.catch(() => {});
    } else {
      inverses = typeof result === "function" ? [result] : [];
    }
    const dispose: Dispose = () => {
      if (!armed) return;
      armed = false;
      fiber.disposables.delete(dispose);
      if (inverses) {
        const r = inverses[0]?.();
        return isPromise(r) ? r.then(() => {}) : undefined;
      }
      return task!.then(runAll, () => {});
    };
    fiber.disposables.add(dispose);
    return dispose;
  }

  /**
   * Provides a capability (Algorithm 2's `set`). It counts only once this
   * fiber is active, and stops counting the moment it starts to unload, so
   * consumers leave before its inverses run.
   */
  provide<T>(key: string, serve: Serve<T>): Dispose {
    const rt = this.runtime;
    return this.effect(() => {
      const binding: Binding = { id: rt.nextId(), key, fiber: this.fiber, serve };
      rt.bind(binding);
      return () => rt.unbind(binding);
    });
  }

  /**
   * A capability this pack injected, as its provider serves it to this
   * context (Algorithm 6). Reads the fiber's committed view, so a pack keeps
   * what it was loaded with through its own teardown. Throws for a key the
   * pack didn't inject: a capability it didn't ask for, it doesn't get.
   */
  get<T = unknown>(key: string): T {
    let f: Fiber | null = this.fiber;
    while (f) {
      const b = f.committed?.get(key);
      if (b) return this.serve(b) as T;
      if (f.inject.includes(key)) throw new Error(`${this.fiber.pack.id}: ${key} is not provided`);
      if (!f.parent) break;
      f = f.parent;
    }
    if (this.fiber === this.runtime.rootFiber) {
      const b = this.runtime.resolve(key);
      if (b) return this.serve(b) as T;
      throw new Error(`${key} is not provided`);
    }
    throw new Error(`${this.fiber.pack.id}: ${key} was not injected`);
  }

  private serve(b: Binding): unknown {
    if (!this.served.has(b.id)) this.served.set(b.id, b.serve(this.caller(b.key), this));
    return this.served.get(b.id);
  }

  /**
   * Who this context is, as a provider of `key` sees it: read live, so a
   * change of interception or a move in the config tree shows at once.
   */
  caller(key?: string): Caller {
    const ctx = this;
    const read = (name: string) => {
      const own = key !== undefined ? ctx.meta.keys[key] : undefined;
      if (own && name in own) return own[name];
      return ctx.meta.all[name];
    };
    return {
      pack: ctx.fiber.pack.id,
      get actor() {
        return read(META.actor) as Actor | undefined;
      },
      get run() {
        return read(META.run) as string | undefined;
      },
      get position() {
        return ctx.fiber.position();
      },
    };
  }

  /**
   * A child context with more metadata (Cordis `ctx.intercept`), for every
   * key or for one. It shares this fiber: what it registers is the same
   * pack's. The adapter makes one per run with the agent and the run.
   */
  intercept(meta: Meta, key?: string): Context {
    const next = { all: { ...this.meta.all }, keys: { ...this.meta.keys } };
    if (key === undefined) next.all = { ...next.all, ...meta };
    else next.keys[key] = { ...next.keys[key], ...meta };
    return new Context(this.runtime, this.fiber, next);
  }

  /**
   * Instantiates a pack as a child fiber (Algorithm 4, `use`). The child is
   * an effect of this fiber, so unloading this one unloads it.
   */
  plugin<C>(pack: Pack<C>, config?: C, options: { position?: () => number[]; disabled?: boolean; source?: string } = {}): Fiber {
    const parent = this.fiber;
    const index = parent.childCount++;
    const fiber = new Fiber(this.runtime, pack, config, parent, this.meta, () =>
      options.position ? options.position() : [...parent.position(), index],
    );
    fiber.disabled = !!options.disabled;
    fiber.source = options.source;
    fiber.dispose =this.effect(() => {
      this.runtime.fibers.add(fiber);
      fiber.refresh();
      return () => fiber.retire();
    });
    return fiber;
  }
}

/** The instantiation of one pack (§5.1.3). */
export class Fiber {
  readonly uid: number;
  readonly runtime: Runtime;
  readonly pack: Pack;
  readonly parent: Fiber | null;
  readonly inject: readonly string[];
  readonly ctx: Context;
  readonly position: () => number[];
  config: unknown;
  /** The module URL the loader imported its pack from, when it was loaded from one. */
  source?: string;
  state: State = "inactive";
  /** The bindings it was loaded with; ⊥ (null) while not loaded. */
  committed: Map<string, Binding> | null = null;
  /** Inverses of its effects, in the order they were made. */
  disposables = new Set<Dispose>();
  /** The transition in flight. */
  inertia: Promise<void> | null = null;
  /** The digest of what it should be loaded against; null is ⊥. */
  target: string | null = null;
  error: unknown = undefined;
  disabled = false;
  childCount = 0;
  /** Retires it (set by the parent's effect). */
  dispose: Dispose = noop;
  private generation = 0;
  private retired = false;

  constructor(
    runtime: Runtime,
    pack: Pack,
    config: unknown,
    parent: Fiber | null,
    meta: Context["meta"] | undefined,
    position: () => number[],
  ) {
    this.uid = runtime.nextId();
    this.runtime = runtime;
    this.pack = pack;
    this.config = config;
    this.parent = parent;
    this.inject = [...(pack.inject ?? [])];
    this.position = position;
    this.ctx = new Context(runtime, this, meta && { all: { ...meta.all }, keys: { ...meta.keys } });
  }

  /** Whether a new effect may be recorded on it. */
  accepting(): boolean {
    return this.state === "loading" || this.state === "active" || this === this.runtime.rootFiber;
  }

  /** The injected keys no active pack provides now: what it waits for. */
  missing(): string[] {
    return this.inject.filter((key) => !this.runtime.resolve(key, this));
  }

  /** The keys whose binding this fiber installed. */
  provided(): string[] {
    return this.runtime.providedBy(this);
  }

  /** target(·) of Definition 53: the providers of every injected key, or ⊥. */
  private computeTarget(): string | null {
    if (this.retired || this.disabled) return null;
    const parts = [`g${this.generation}`];
    for (const key of this.inject) {
      const b = this.runtime.resolve(key, this);
      if (!b) return null;
      parts.push(`${key}=${b.id}`);
    }
    return parts.join(",");
  }

  /** Algorithm 5's refresh: recompute the target, and start a transition if it moved. */
  refresh(): void {
    const target = this.computeTarget();
    if (target === this.target) return;
    this.target = target;
    if (this.inertia) return;
    if (target !== null && (this.state === "inactive" || this.state === "failed")) {
      this.state = "loading";
      this.inertia = this.reload();
    } else if (this.state === "active") {
      this.state = "unloading";
      this.inertia = this.unload();
    } else if (target === null && this.state === "failed") {
      this.state = "inactive";
    }
  }

  private async reload(): Promise<void> {
    const target0 = this.target;
    this.error = undefined;
    this.committed = new Map();
    for (const key of this.inject) {
      const b = this.runtime.resolve(key, this);
      if (b) this.committed.set(key, b);
    }
    let failed = false;
    try {
      const result = this.pack.apply(this.ctx, this.config) as EffectResult;
      const inverses = await execute(result, () => this.target === target0);
      // Yielded inverses join the fiber's own, after what apply registered.
      for (const inv of inverses) this.disposables.add(inv as Dispose);
    } catch (e) {
      failed = true;
      this.error = e;
      this.runtime.report(this, e);
    }
    if (failed) {
      // What it registered before failing is taken back. The failure is
      // kept against its target; a new target tries again.
      this.state = "unloading";
      await this.flush();
      this.committed = null;
      this.inertia = null;
      if (this.target !== null && this.target !== target0) {
        this.state = "loading";
        this.inertia = this.reload();
      } else {
        this.state = this.target === null ? "inactive" : "failed";
      }
      return;
    }
    if (this.target === target0) {
      this.state = "active";
      this.inertia = null;
      this.runtime.notify(this.provided());
    } else {
      this.state = "unloading";
      this.inertia = this.unload();
    }
  }

  private async unload(): Promise<void> {
    // L-Leave: it stopped providing when it became `unloading`. Its
    // dependents see that now and leave first, while its bindings stand.
    // Removal is never refused, only ordered: a dependent whose teardown
    // hangs past the runtime's limit is reported and left behind.
    const dependents = this.runtime.notify(this.provided()).filter((f) => f !== this);
    const limit = this.runtime.teardownLimit;
    await Promise.all(
      dependents.map(async (f) => {
        if (!(await within(f.settled(), limit))) {
          this.runtime.report(f, new Error(`${f.pack.id}: teardown took over ${limit}ms; ${this.pack.id} unloads without it`));
        }
      }),
    );
    await this.flush();
    this.committed = null;
    if (this.target === null) {
      this.state = "inactive";
      this.inertia = null;
      if (this.retired) this.runtime.fibers.delete(this);
    } else {
      this.state = "loading";
      this.inertia = this.reload();
    }
  }

  /** Runs every inverse, last first. */
  private async flush(): Promise<void> {
    const all = [...this.disposables];
    this.disposables.clear();
    for (let i = all.length - 1; i >= 0; i--) {
      try {
        if (!(await within(all[i]!(), this.runtime.teardownLimit))) {
          this.runtime.report(this, new Error(`${this.pack.id}: an undo took over ${this.runtime.teardownLimit}ms; skipped`));
        }
      } catch (e) {
        this.runtime.report(this, e);
      }
    }
  }

  /** Resolves once no transition is in flight. */
  async settled(): Promise<void> {
    while (this.inertia) await this.inertia;
  }

  /** Reloads it with a new config: unload, then load again. */
  update(config: unknown): Promise<void> {
    this.config = config;
    this.generation++;
    this.refresh();
    return this.settled();
  }

  /** Turns it off or on, keeping its place. */
  setDisabled(disabled: boolean): Promise<void> {
    this.disabled = disabled;
    this.refresh();
    return this.settled();
  }

  /** The inverse of instantiation: target ⊥, unload, leave the runtime. */
  retire(): Promise<void> {
    this.retired = true;
    this.refresh();
    return this.settled().then(() => {
      this.runtime.fibers.delete(this);
    });
  }
}

/** The runtime: the store of bindings, every fiber, and the root context. */
export class Runtime {
  readonly fibers = new Set<Fiber>();
  readonly rootFiber: Fiber;
  readonly root: Context;
  /** Where load errors go. Tests and hosts replace it. */
  onError: (fiber: Fiber, error: unknown) => void = (fiber, error) => {
    console.error(`[${fiber.pack.id}]`, error);
  };
  /** How long one undo, or a dependent's whole teardown, may take (ms). */
  teardownLimit = 5000;
  private bindings = new Map<string, Binding[]>();
  private ids = 0;

  constructor() {
    this.rootFiber = new Fiber(this, { id: "kernel", apply() {} }, undefined, null, undefined, () => []);
    this.rootFiber.state = "active";
    this.root = this.rootFiber.ctx;
  }

  nextId(): number {
    return ++this.ids;
  }

  report(fiber: Fiber, error: unknown): void {
    this.onError(fiber, error);
  }

  bind(b: Binding): void {
    const list = this.bindings.get(b.key) ?? [];
    list.push(b);
    this.bindings.set(b.key, list);
    this.notify([b.key]);
  }

  unbind(b: Binding): void {
    const list = this.bindings.get(b.key);
    if (!list) return;
    const i = list.indexOf(b);
    if (i < 0) return;
    list.splice(i, 1);
    if (!list.length) this.bindings.delete(b.key);
    this.notify([b.key]);
  }

  /**
   * The binding a key resolves to: among active providers, the first in
   * the config tree, then the first registered. A fiber never resolves a key
   * to its own binding.
   */
  resolve(key: string, asker?: Fiber): Binding | undefined {
    let best: Binding | undefined;
    for (const b of this.bindings.get(key) ?? []) {
      if (b.fiber === asker || b.fiber.state !== "active") continue;
      if (!best) best = b;
      else {
        const d = byPosition({ position: b.fiber.position() } as Caller, { position: best.fiber.position() } as Caller);
        if (d < 0 || (d === 0 && b.id < best.id)) best = b;
      }
    }
    return best;
  }

  providedBy(fiber: Fiber): string[] {
    const keys: string[] = [];
    for (const [key, list] of this.bindings) if (list.some((b) => b.fiber === fiber)) keys.push(key);
    return keys;
  }

  /** Algorithm 3: re-evaluate every fiber that injects one of `keys`. */
  notify(keys: readonly string[]): Fiber[] {
    if (!keys.length) return [];
    const affected: Fiber[] = [];
    for (const fiber of [...this.fibers]) {
      if (fiber.inject.some((k) => keys.includes(k))) {
        fiber.refresh();
        affected.push(fiber);
      }
    }
    return affected;
  }

  /** Re-evaluates every fiber: after the config tree is reordered. */
  reorder(): void {
    this.notify([...new Set([...this.fibers].flatMap((f) => f.inject))]);
  }

  /** Resolves once every fiber is quiescent. */
  async settle(): Promise<void> {
    for (;;) {
      const busy = [...this.fibers].filter((f) => f.inertia);
      if (!busy.length) return;
      await Promise.all(busy.map((f) => f.settled()));
    }
  }

  /** Every key provided by an active fiber now. */
  keys(): string[] {
    return [...this.bindings.keys()].filter((k) => this.resolve(k));
  }
}
