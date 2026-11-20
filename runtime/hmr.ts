/**
 * The module graph HMR walks (Cordis §5.2.2). Isomorphic: the Node host
 * fills it from a resolve hook, the dev server from the modules it serves.
 *
 * A changed module, and every module that imports one, must be evaluated
 * again for the change to be seen (Algorithm 8). Each such module gets a
 * new version, and the hosts put it in the module's URL (`?v=3`), so the
 * next import is a fresh instance while untouched modules stay shared.
 * Declined modules (the runtime itself, node_modules) are never versioned:
 * a change that reaches one needs a restart, and the host says so.
 */
export class ModuleGraph {
  private imports = new Map<string, Set<string>>();
  private versions = new Map<string, number>();

  /** Records that `from` imports `to`. Both are URLs without a query. */
  record(from: string, to: string): void {
    let set = this.imports.get(from);
    if (!set) this.imports.set(from, (set = new Set()));
    set.add(to);
  }

  /** Replaces what `from` imports (the dev server, as it serves a module again). */
  setImports(from: string, to: Iterable<string>): void {
    this.imports.set(from, new Set(to));
  }

  has(url: string): boolean {
    if (this.imports.has(url)) return true;
    for (const set of this.imports.values()) if (set.has(url)) return true;
    return false;
  }

  /** Every module it knows. */
  modules(): string[] {
    const all = new Set<string>();
    for (const [from, to] of this.imports) {
      all.add(from);
      for (const u of to) all.add(u);
    }
    return [...all];
  }

  version(url: string): number {
    return this.versions.get(url) ?? 0;
  }

  /** The URL to import `url` at now: with its version, if it has one. */
  versioned(url: string): string {
    const v = this.version(url);
    return v ? `${url}${url.includes("?") ? "&" : "?"}v=${v}` : url;
  }

  /**
   * Algorithm 8: what a change reaches. `accepted` is the changed modules
   * and every module that imports one, up to the entries; `declined` is
   * any declined module the change reached, which needs a restart.
   */
  classify(changed: Iterable<string>, declined: (url: string) => boolean) {
    const accepted = new Set<string>();
    const refused = new Set<string>();
    for (const url of changed) (declined(url) ? refused : accepted).add(url);
    for (let progress = true; progress; ) {
      progress = false;
      for (const [from, to] of this.imports) {
        if (accepted.has(from) || refused.has(from)) continue;
        if ([...to].some((u) => accepted.has(u))) {
          (declined(from) ? refused : accepted).add(from);
          progress = true;
        }
      }
    }
    return { accepted, declined: refused };
  }

  /** Gives each module a new version. */
  bump(urls: Iterable<string>): void {
    for (const url of urls) this.versions.set(url, this.version(url) + 1);
  }

  /** Every versioned module and its version. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.versions);
  }
}
