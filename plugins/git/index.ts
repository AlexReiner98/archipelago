/**
 * The git plugin: a run's repository as facts (spec/agent.md, edition 5).
 *
 * - A fact source reads the run's `cwd` with git: `remote` (origin's url as
 *   `host/owner/name`, steadier than the folder, which worktrees and
 *   machines change), `branch`, and `repo`, the id of the map's item for
 *   that remote.
 * - The flavour `repo` (of record, field `remote`): one item per remote,
 *   made through `git.repo` the first time a run is seen there. A link from
 *   it is how the map says something about every run in that repository
 *   (plugins/profile: `uses`).
 *
 * Injects agent.facts for the source, graph.read and graph.watch to find
 * repo items, types.define for the flavour, action.register and
 * action.invoke for `git.repo`. Server only: it runs git.
 */
import { execFile } from "node:child_process";
import type { ActionContext, ActionInvoke, ActionRegister } from "../../spec/action.ts";
import type { AgentFacts, Facts } from "../../spec/agent.ts";
import type { Id } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { FlavourDef, TypesDefine } from "../../spec/types.ts";
import type { Context, Plugin } from "../../runtime/core.ts";

export const TYPE = "repo";
export const MAKE = "git.repo";

export const REPO: FlavourDef = {
  name: TYPE,
  base: "record",
  doc: "A git repository, by its remote: what runs in it have in common.",
  trial: false,
  fields: { remote: { kind: "text", doc: "Origin's url as host/owner/name." } },
};

/** A remote url as `host/owner/name`: https, ssh and scp forms alike, no `.git`, no credentials. */
export function normalRemote(url: string): string | undefined {
  const u = url.trim();
  if (!u) return undefined;
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(u);
  let host: string;
  let path: string;
  if (scp) {
    host = scp[1]!;
    path = scp[2]!;
  } else {
    try {
      const p = new URL(u);
      if (p.protocol === "file:") return undefined;
      host = p.hostname;
      path = p.pathname;
    } catch {
      return undefined;
    }
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  return path ? `${host.toLowerCase()}/${path}` : undefined;
}

/** A remote a run's start gave: a url, or already `host/owner/name`. Anything else isn't one. */
export function givenRemote(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== "string" || !v.trim()) return undefined;
  const n = normalRemote(v);
  if (n) return n;
  const s = v.trim().replace(/\.git$/i, "");
  return /^[\w.-]+(\/[\w.-]+){2,}$/.test(s) ? s.replace(/^[^/]+/, (h) => h.toLowerCase()) : undefined;
}

export interface GitConfig {
  /** Runs git in a folder; replaced in tests. */
  git?: (cwd: string, args: string[]) => Promise<string | undefined>;
}

const realGit = (cwd: string, args: string[]) =>
  new Promise<string | undefined>((resolve) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 3000, windowsHide: true }, (err, out) => resolve(err ? undefined : String(out).trim() || undefined));
  });

const key = (remote: string) => remote.toLowerCase();

const git: Plugin<GitConfig> = {
  id: "git",
  about: "Notes which git repository each agent session works in.",
  inject: ["agent.facts", "graph.read", "graph.watch", "types.define", "action.register", "action.invoke"],
  async apply(ctx: Context, config: GitConfig = {}) {
    const run = config.git ?? realGit;
    const graph = ctx.get<GraphRead>("graph.read");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    ctx.get<TypesDefine>("types.define").flavour(REPO);

    /** Repo items by remote; kept from the change sets as they commit. */
    const byRemote = new Map<string, Id>();
    const remoteOf = new Map<Id, string>();
    const keep = (id: Id, remote: unknown, gone: boolean) => {
      const had = remoteOf.get(id);
      if (had) byRemote.delete(key(had));
      remoteOf.delete(id);
      if (!gone && typeof remote === "string" && remote) {
        remoteOf.set(id, remote);
        if (!byRemote.has(key(remote))) byRemote.set(key(remote), id);
      }
    };
    ctx.get<GraphWatch>("graph.watch").watch({ types: [TYPE] }, async (change) => {
      const ids = [...new Set(change.facts.map((f) => f[1]))];
      const now = await graph.get(ids);
      ids.forEach((id, i) => keep(id, now[i]?.fields.remote, !now[i] || now[i]!.type !== TYPE));
    });
    for (let p = await graph.of(TYPE, { limit: LIMIT_MAX }); ; p = await graph.of(TYPE, { limit: LIMIT_MAX, after: p.next })) {
      for (const item of p.items) keep(item.id, item.fields.remote, false);
      if (!p.next) break;
    }

    ctx.get<ActionRegister>("action.register").register({
      name: MAKE,
      title: "The map's item for a git repository",
      doc: "Found by its remote, or made the first time.",
      input: { type: "object", properties: { remote: { type: "string", description: "host/owner/name" } }, required: ["remote"] },
      async run(input: { remote: string }, call: ActionContext) {
        const remote = normalRemote(input.remote) ?? input.remote?.trim();
        if (!remote || !remote.includes("/")) throw new Refused({ code: "git.remote", message: `${JSON.stringify(input.remote)} is not a remote (host/owner/name).`, by: { plugin: "git" } });
        const had = byRemote.get(key(remote));
        if (had) return { repo: had };
        const id = `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        call.write([
          ["+", id, "type", TYPE],
          ["+", id, "title", remote.split("/").pop()!],
          ["+", id, "remote", remote],
          ["+", id, "status", "current"],
        ]);
        return { repo: id };
      },
    });

    /** One make at a time per remote, so two runs starting together don't make two items. */
    const making = new Map<string, Promise<Id | undefined>>();
    const repoFor = (remote: string): Promise<Id | undefined> => {
      const known = byRemote.get(key(remote));
      if (known) return Promise.resolve(known);
      const k = key(remote);
      let p = making.get(k);
      if (!p) {
        p = invoke
          .invoke<{ repo: Id }>({ action: MAKE, input: { remote }, authority: { of: "agent", basis: "the git plugin: the first run seen in this repository" }, reason: `First run seen in ${remote}` })
          .then((out) => (out.ok ? out.output.repo : undefined))
          .finally(() => making.delete(k));
        making.set(k, p);
      }
      return p;
    };

    ctx.get<AgentFacts>("agent.facts").source({
      name: "repo",
      async facts(info) {
        // A remote the run's start gave (the hook read it where the session runs): used as it is, so a
        // server that can't see the folder still finds the repo item. Else git reads the folder here.
        // So is a branch it gave: git reads the folder only for what the start didn't say.
        const given = givenRemote(info.facts?.remote);
        const givenBranch = typeof info.facts?.branch === "string" && info.facts.branch ? info.facts.branch : undefined;
        const cwd = typeof info.facts?.cwd === "string" ? info.facts.cwd : info.cwd;
        if (!cwd && !given && !givenBranch) return null;
        const [url, read] = cwd ? await Promise.all([given ? undefined : run(cwd, ["remote", "get-url", "origin"]), givenBranch ? undefined : run(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])]) : [undefined, undefined];
        const branch = givenBranch ?? read;
        const out: Facts = {};
        const remote = given ?? (url ? normalRemote(url) : undefined);
        if (remote) {
          out.remote = remote;
          const repo = await repoFor(remote);
          if (repo) out.repo = repo;
        }
        if (branch && branch !== "HEAD") out.branch = branch;
        return out;
      },
    });
  },
};

export default git;
