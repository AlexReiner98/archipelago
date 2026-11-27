/**
 * The claim plugin: agents working on one repository at once (in one folder,
 * or in worktrees of it) agree on a shared plan, and the map holds them to
 * it. A run claims the files it will write (`claim.take`, with what it means
 * to do), or holds one on its first write. A write to a file another live
 * run holds is refused, naming the holder and its intent; a read of one is
 * told. Each run hears the plan, what the others hold, while it works.
 *
 * The plan is on the map: a `plan` item per repository (or folder), and an
 * `intent` part_of it for each claim, with its files and branch, held
 * (`doing`) for the turn: until the run's reply ends, or the run ends
 * (`done`), or it lets go (`dropped` when it wrote none of them). An intent
 * that waited for another depends_on it. Like any change it is undone with
 * history; the holds follow the map (graph.watch). A hold on first write is
 * not a claim: it stays off the map, and goes with the turn too.
 *
 * Injects agent.node, action.register, action.invoke, exchange.watch,
 * graph.read, graph.watch and types.define; provides its own `claim.read`
 * (the plan, and a watch on it) for the page.
 */
import { execFileSync } from "node:child_process";
import { runName, type AgentNode, type RunInfo } from "../../spec/agent.ts";
import type { ActionContext, ActionInvoke, ActionRegister } from "../../spec/action.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Dispose, Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { FlavourDef, TypesDefine } from "../../spec/types.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import {
  covers,
  heldByOther,
  INTENT,
  intentOf,
  norm,
  PLAN,
  planWords,
  REPO,
  scopeTitle,
  TURNED_KEEP,
  WRITES,
  type Hold,
  type IntentView,
  type PlanState,
  type PlanView,
  type Turned,
  type Wait,
} from "./plan.ts";

export * from "./plan.ts";

/** Minutes a run may be quiet and still hold its files: as a session counts as live. */
export const QUIET_MIN = 15;

/** The longest one claim.take waits for a held file, in seconds: under a harness's tool call timeout, so the agent sees the answer and can call again. */
export const WAIT_MAX = 25;
const WAKE_MS = 5_000;

/** Intents kept to show, per plan: the open ones and the latest closed. */
export const SHOW_PER_PLAN = 40;
/** Plans shown, the latest first. */
export const SHOW_PLANS = 12;
/** Pages read when the plugin loads, to find the open intents (LIMIT_MAX each). */
const LOAD_PAGES = 20;

export const PLAN_DEF: FlavourDef = {
  name: PLAN,
  base: "work",
  doc: "The shared plan of the agents working on one repository or folder: its intents are part_of it.",
  trial: false,
  fields: {
    scope: { kind: "text", doc: "What the agents share: repo:host/owner/name, or a folder." },
  },
};

export const INTENT_DEF: FlavourDef = {
  name: INTENT,
  base: "work",
  doc: "What one agent claimed to do and the files it holds for it: doing while held, done when its run ended, dropped when let go. depends_on the intents it waited for.",
  trial: false,
  fields: {
    run: { kind: "text", doc: "The run that claimed it." },
    agent: { kind: "text", doc: "The run's name, as people see it." },
    files: { kind: "json", doc: "The paths it holds, relative to the repository or folder; a folder ends in /." },
    scope: { kind: "text", doc: "Its plan's scope." },
    branch: { kind: "text", doc: "The branch the run works on." },
    folder: { kind: "text", doc: "The run's folder: a checkout of the repository." },
    asked: { kind: "text", doc: "When it was first asked for, when it waited for another run to let go." },
    since: { kind: "text", doc: "When it was claimed." },
    ended: { kind: "text", doc: "When it was done or dropped." },
  },
};

/** `claim.read`: the plan now, and each change to it. */
export interface ClaimRead {
  plan(): PlanState;
  watch(on: (plan: PlanState) => void): Dispose;
}

export interface ClaimConfig {
  /** What two runs share when they share a file: their repository (the `remote` fact; the default, when a run has one), so two worktrees or clones of one repository are held apart too; or only their folder. */
  by?: "folder" | "repo";
  /** Minutes quiet before a run's holds go. */
  quiet_min?: number;
}

const newId = () => `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const same = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a) === JSON.stringify(b);
/** The facts that move one field from `old` to `now`. */
const move = (id: Id, field: string, old: Json | undefined, now: Json | undefined): Fact[] =>
  same(old, now) ? [] : [...(old !== undefined ? [["-", id, field, old] as Fact] : []), ...(now !== undefined ? [["+", id, field, now] as Fact] : [])];

const claim: Plugin<ClaimConfig> = {
  id: "claim",
  about: "Agents on one repository agree on a shared plan, kept on the map: who holds which file, and what for. A write to a file another live run holds is refused.",
  inject: ["agent.node", "action.register", "action.invoke", "exchange.watch", "graph.read", "graph.watch", "types.define"],
  async apply(ctx: Context, config: ClaimConfig = {}) {
    const define = ctx.get<TypesDefine>("types.define");
    define.flavour(PLAN_DEF);
    define.flavour(INTENT_DEF);
    const graph = ctx.get<GraphRead>("graph.read");
    const invoke = ctx.get<ActionInvoke>("action.invoke");

    const quietMs = (config.quiet_min ?? QUIET_MIN) * 60_000;
    const runs = new Map<string, { info: RunInfo; last: number }>();
    /** Plans by scope, and the intents to show: the map's, as last read or written. */
    const plans = new Map<string, { id: Id; title: string }>();
    const intents = new Map<Id, IntentView>();
    /** Holds on first write: no claim, so not on the map. */
    let loose: Hold[] = [];
    let turned: Turned[] = [];
    let prevented = 0;
    let waits: Wait[] = [];
    /** The files each run wrote: a claim let go after writing is done, not dropped. */
    const wrote = new Map<string, Set<string>>();
    /** Runs told how to claim, since another agent works beside them. */
    const told = new Set<string>();
    const watchers = new Set<(p: PlanState) => void>();
    // Runs waiting in claim.take for a file to come free: woken at each change.
    const waiting = new Set<() => void>();

    /** Every hold now: each file of each intent held, then the holds on first write. */
    const holdsNow = (): Hold[] => {
      const out: Hold[] = [];
      for (const i of intents.values()) {
        if (i.status !== "doing") continue;
        for (const file of i.files) out.push({ scope: i.scope, file, run: i.run, title: i.agent, intent: i.title, how: "claimed", since: i.since, ...(i.branch ? { branch: i.branch } : {}), ...(i.folder ? { where: i.folder } : {}), item: i.id });
      }
      return [...out, ...loose];
    };
    const plansNow = (): PlanView[] => {
      const by = new Map<Id, PlanView>();
      for (const [scope, p] of plans) by.set(p.id, { id: p.id, scope, title: p.title, intents: [] });
      for (const i of intents.values()) if (i.plan) by.get(i.plan)?.intents.push(i);
      const last = (p: PlanView) => p.intents.reduce((m, i) => (i.ended ?? (i.status === "doing" ? "~" : i.since)) > m ? (i.ended ?? (i.status === "doing" ? "~" : i.since)) : m, "");
      return [...by.values()]
        .filter((p) => p.intents.length)
        .map((p) => ({ ...p, intents: p.intents.sort((a, b) => a.since.localeCompare(b.since)) }))
        .sort((a, b) => last(b).localeCompare(last(a)))
        .slice(0, SHOW_PLANS);
    };
    const state = (): PlanState => ({ plans: plansNow(), holds: holdsNow(), waits: [...waits], turned: [...turned], prevented });
    const changed = () => {
      const s = state();
      for (const w of watchers) w(s);
      for (const wake of [...waiting]) wake();
    };
    /** Keeps the open intents and the latest closed ones of each plan. */
    const trim = () => {
      const byPlan = new Map<string, IntentView[]>();
      for (const i of intents.values()) if (i.status !== "doing") byPlan.set(i.scope, [...(byPlan.get(i.scope) ?? []), i]);
      for (const list of byPlan.values()) {
        list.sort((a, b) => (b.ended ?? b.since).localeCompare(a.ended ?? a.since));
        for (const old of list.slice(SHOW_PER_PLAN)) intents.delete(old.id);
      }
    };

    const scopeOf = (r: RunInfo) => {
      const remote = typeof r.facts?.remote === "string" ? r.facts.remote : undefined;
      return config.by !== "folder" && remote ? REPO + remote : norm(r.cwd ?? "");
    };
    // A run's branch, read once from its folder: a run in another checkout gets a holder's change only by merging its branch.
    const branches = new Map<string, string | undefined>();
    const branchOf = (r: RunInfo): string | undefined => {
      if (branches.has(r.run)) return branches.get(r.run);
      let b: string | undefined;
      try {
        if (r.cwd) b = execFileSync("git", ["-C", r.cwd, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: 1000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
      } catch {}
      branches.set(r.run, b && b !== "HEAD" ? b : undefined);
      return branches.get(r.run);
    };
    /** Words for a run that must wait on a holder in another checkout: wait, then merge. Empty when they share a checkout. */
    const mergeWords = (r: RunInfo, other: Hold) =>
      other.branch && norm(other.where ?? "") !== norm(r.cwd ?? "")
        ? ` They work in another checkout, on branch ${other.branch}: their change reaches yours only by merge. Once they let go, run \`git merge ${other.branch}\` before you edit, so your work builds on theirs.`
        : "";
    const seen = (r: RunInfo) => {
      const had = runs.get(r.run);
      runs.set(r.run, { info: r, last: Date.now() });
      return had;
    };
    /** A replay (plugins/replay) plays a past run again: it is not an agent working now, so it holds nothing and is turned away from nothing. */
    const replay = (r: RunInfo) => r.facts?.replay_of !== undefined;
    /** The other runs live on this run's repository or folder now. */
    const peers = (r: RunInfo) => {
      const scope = scopeOf(r);
      const now = Date.now();
      return [...runs.values()].filter((x) => x.info.run !== r.run && !replay(x.info) && now - x.last <= quietMs && scopeOf(x.info) === scope);
    };

    /** A run's turn is over: its intents are done (on the map), its holds on first write go. */
    const releasing = new Set<string>();
    const release = (run: string) => {
      const before = loose.length;
      loose = loose.filter((h) => h.run !== run);
      const open = [...intents.values()].some((i) => i.run === run && i.status === "doing");
      if (open && !releasing.has(run)) {
        releasing.add(run);
        void invoke
          .invoke({ action: "claim.release", input: { run }, authority: { of: "agent", basis: "the run ended or went quiet" }, reason: "A run's claims end with it" })
          // Once per run: a refusal leaves its intents open on the map, where a person can close them.
          .then((out) => void (out.ok && releasing.delete(run)))
          .catch(() => undefined);
      } else if (loose.length !== before) changed();
    };
    // Runs that went quiet let go, each time the plan is read; so do intents of runs this server never saw, once quiet that long.
    const expire = () => {
      const now = Date.now();
      for (const [run, r] of runs) if (now - r.last > quietMs) (runs.delete(run), told.delete(run), release(run));
      for (const i of intents.values()) if (i.status === "doing" && !runs.has(i.run) && now - Date.parse(i.since) > quietMs) release(i.run);
    };
    const holdLoose = (r: RunInfo, file: string) => {
      const branch = branchOf(r);
      loose.push({ scope: scopeOf(r), file, run: r.run, title: runName(r), intent: "", how: "on_write", since: new Date().toISOString(), ...(branch ? { branch } : {}), ...(r.cwd ? { where: r.cwd } : {}) });
    };

    // The map as it is: plans, then the open intents and the latest closed, with what each built on.
    const readAfter = async (id: Id): Promise<Id[]> => (await graph.links(id, { type: "depends_on", dir: "out" }, { limit: LIMIT_MAX })).items.map((l) => l.to);
    const readPlanOf = async (id: Id): Promise<Id | undefined> => (await graph.links(id, { type: "part_of", dir: "out" }, { limit: 10 })).items.map((l) => l.to).find((to) => [...plans.values()].some((p) => p.id === to));
    const load = async () => {
      let after: string | undefined;
      for (let n = 0; n < LOAD_PAGES; n++) {
        const page = await graph.of(PLAN, { limit: LIMIT_MAX, ...(after ? { after } : {}) });
        for (const p of page.items) if (typeof p.fields.scope === "string") plans.set(p.fields.scope, { id: p.id, title: String(p.fields.title ?? "Shared plan") });
        if (!page.next) break;
        after = page.next;
      }
      after = undefined;
      const found: Item[] = [];
      for (let n = 0; n < LOAD_PAGES; n++) {
        const page = await graph.of(INTENT, { limit: LIMIT_MAX, ...(after ? { after } : {}) });
        found.push(...page.items);
        if (!page.next) break;
        after = page.next;
      }
      for (const item of found) {
        const v = intentOf(item);
        if (v) intents.set(v.id, v);
      }
      trim();
      for (const v of intents.values()) intents.set(v.id, { ...v, after: await readAfter(v.id), plan: await readPlanOf(v.id) });
    };
    await load();

    // The map is the truth: an intent changed by anyone (undo above all) is read again, and the holds follow.
    ctx.effect(() =>
      ctx.get<GraphWatch>("graph.watch").watch({ types: [INTENT, PLAN, "depends_on", "part_of"] }, (change) => {
        const ids = new Set<Id>();
        for (const [, id, field, value] of change.facts) {
          ids.add(id);
          if (field === "from" && typeof value === "string") ids.add(value);
        }
        void (async () => {
          const items = await graph.get([...ids].slice(0, LIMIT_MAX));
          let any = false;
          for (const [k, id] of [...ids].entries()) {
            const item = items[k];
            if (item?.type === PLAN && typeof item.fields.scope === "string") (plans.set(item.fields.scope, { id, title: String(item.fields.title ?? "Shared plan") }), (any = true));
            if (item?.type === INTENT) {
              const v = intentOf(item, await readAfter(id), await readPlanOf(id));
              if (v) (intents.set(id, v), (any = true));
            } else if (!item && intents.has(id)) (intents.delete(id), (any = true));
          }
          if (any) (trim(), changed());
        })();
      }),
    );

    ctx.effect(() =>
      ctx.get<ExchangeWatch>("exchange.watch").watch({}, (e) => {
        if (e.kind === "end") (runs.delete(e.run), branches.delete(e.run), told.delete(e.run), wrote.delete(e.run), release(e.run));
        else if (e.kind === "begin" && e.detail && typeof e.detail === "object") seen(e.detail as unknown as RunInfo);
        else {
          const r = runs.get(e.run);
          if (r) r.last = Date.now();
        }
      }),
    );

    const HOW =
      'Another agent is working on this repository now. Agree the plan before you edit: claim the files you will write, with what you will do, act claim.take {"files": [...], "intent": "what you will do"} (a folder ends in /). The plan is kept on the map. A file you write is held for you on its first write anyway; a write to a file another agent holds is refused. When a file you need is held, wait for it with "wait_s" in claim.take rather than leaving your task half done.';
    /** How to claim, said once to a run, and only while another agent works beside it. */
    const howFor = (run: RunInfo): string => {
      if (told.has(run.run) || !peers(run).length) return "";
      told.add(run.run);
      return HOW;
    };

    const node = ctx.get<AgentNode>("agent.node");

    // The plan, as each run starts and at each prompt: once per context while it says the same.
    node.node({
      name: "plan",
      kind: "instruction",
      title: "Shared plan: what other agents hold",
      at: ["session_start", "prompt"],
      speak(_m, run) {
        if (replay(run)) return null;
        seen(run);
        expire();
        const words = [howFor(run), planWords(holdsNow(), scopeOf(run), run.run)].filter(Boolean).join("\n\n");
        return words ? { say: words } : null;
      },
    });

    // The hold itself: at every file a tool is about to touch.
    node.node({
      name: "held",
      kind: "rule",
      title: "Refuses a write to a file another agent holds",
      at: ["file:**"],
      repeat: "every",
      speak(m, run) {
        if (replay(run)) return null;
        seen(run);
        expire();
        const tool = m.places.find((p) => p.startsWith("tool:"))?.slice(5) ?? "";
        const scope = scopeOf(run);
        const files = m.places.filter((p) => p.startsWith("file:")).map((p) => norm(p.slice(5), run.cwd));
        const holds = holdsNow();
        for (const file of files) {
          const other = heldByOther(holds, scope, file, run.run);
          if (!other) continue;
          if (!WRITES.has(tool)) return { say: `${other.title} holds ${file}${other.intent ? ` to ${other.intent}` : ""}: it may change under you.` };
          prevented++;
          told.add(run.run);
          turned = [{ scope, file, run: run.run, title: runName(run), holder: other.run, holder_title: other.title, intent: other.intent, tool, time: m.time }, ...turned].slice(0, TURNED_KEEP);
          changed();
          return {
            refuse: `${other.title} holds ${file}${other.intent ? ` (${other.intent})` : ""}. The shared plan gives it to them while they work. To wait for it, act claim.take {"files": ["${file}", …every other file you will change], "intent": "…", "wait_s": ${WAIT_MAX}}: it answers once they let go (call it again while it says they still hold it), then re-read the file, since it changed.${mergeWords(run, other)} Or pick work that doesn't touch it.`,
            code: "claim.held",
          };
        }
        const how = howFor(run);
        if (WRITES.has(tool)) {
          wrote.set(run.run, new Set([...(wrote.get(run.run) ?? []), ...files]));
          let added = false;
          for (const file of files) {
            if (holds.some((h) => h.run === run.run && h.scope === scope && covers(h.file, file))) continue;
            holdLoose(run, file);
            added = true;
          }
          if (added) changed();
        }
        return how ? { say: how } : null;
      },
    });

    // A hold lasts a turn: as the run's reply ends, it lets go, so another agent waits minutes, not the life of a session.
    node.node({
      name: "turn",
      kind: "rule",
      title: "Lets go of a run's holds as its turn ends",
      at: ["reply_end"],
      repeat: "every",
      speak(_m, run) {
        if (replay(run)) return null;
        seen(run);
        release(run.run);
        return null;
      },
    });

    const reg = ctx.get<ActionRegister>("action.register");
    const runOf = (call: ActionContext): RunInfo => {
      const id = call.caller.run;
      const r = id ? runs.get(id) : undefined;
      if (!r) throw new Refused({ code: "claim.no_run", message: "Only an agent in a run can hold files: call this from a session the map knows.", by: { plugin: "claim" } });
      r.last = Date.now();
      return r.info;
    };
    const openOf = (run: string) => [...intents.values()].filter((i) => i.run === run && i.status === "doing");
    /** The facts that close an intent, and the view after. */
    const close = (i: IntentView, status: "done" | "dropped", at: string): Fact[] => {
      intents.set(i.id, { ...i, status, ended: at });
      return [...move(i.id, "status", i.status, status), ...move(i.id, "ended", i.ended, at)];
    };

    reg.register({
      name: "claim.take",
      title: "Claim files for this run: what you will write, and why",
      doc: "Puts the claim on the shared plan, on the map: an intent with its files, held while the run is live. Refused, holding nothing, when another run holds any of them: the refusal names it and what it is doing. With wait_s, waits for them; the intent then depends_on the ones it waited for.",
      input: {
        type: "object",
        required: ["files", "intent"],
        properties: {
          files: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50, description: "Paths relative to the folder; a folder ends in /" },
          intent: { type: "string", description: "What you will do there, in a few words" },
          wait_s: { type: "number", minimum: 0, maximum: WAIT_MAX, description: `Seconds to wait for files another run holds to come free (at most ${WAIT_MAX}); without it, refused at once` },
        },
      },
      async run(input: { files: string[]; intent: string; wait_s?: number }, call) {
        const r = runOf(call);
        told.add(r.run);
        expire();
        const scope = scopeOf(r);
        const intent = input.intent.trim();
        const files = [...new Set(input.files.map((f) => norm(f, r.cwd)).filter(Boolean))];
        const clashOf = () => files.map((f) => heldByOther(holdsNow(), scope, f, r.run)).find(Boolean);
        let clash = clashOf();
        // Holders this run waited for: it builds on their intents, and merges their branches when they are in another checkout.
        const merge = new Set<string>();
        const built = new Set<Id>();
        const note = () => {
          if (!clash) return;
          if (mergeWords(r, clash)) merge.add(clash.branch!);
          if (clash.item) built.add(clash.item);
        };
        note();
        const until = Date.now() + Math.min(Math.max(input.wait_s ?? 0, 0), WAIT_MAX) * 1000;
        const waitBranch = branchOf(r);
        const queued: Wait = { scope, run: r.run, title: runName(r), files, intent, since: new Date().toISOString(), ...(waitBranch ? { branch: waitBranch } : {}) };
        const asked = clash ? queued.since : undefined;
        if (clash && Date.now() < until) (waits = [...waits, queued], changed());
        while (clash && Date.now() < until) {
          // Woken by any change to the plan, or each few seconds to let quiet holders' holds go.
          await new Promise<void>((ok) => {
            const wake = () => (waiting.delete(wake), clearTimeout(t), ok());
            const t = setTimeout(wake, Math.min(WAKE_MS, Math.max(until - Date.now(), 0)));
            waiting.add(wake);
          });
          expire();
          const me = runs.get(r.run);
          if (me) me.last = Date.now();
          clash = clashOf();
          note();
        }
        if (waits.includes(queued)) {
          waits = waits.filter((w) => w !== queued);
          if (clash) changed();
        }
        if (clash) {
          throw new Refused({
            code: "claim.held",
            message: `${clash.title} holds ${clash.file}${clash.intent ? ` (${clash.intent})` : ""}${input.wait_s ? `, still, after ${Math.round(input.wait_s)}s` : ""}. Call claim.take again with \`wait_s\` (up to ${WAIT_MAX}) to keep waiting, or claim other files.${mergeWords(r, clash)}`,
            by: { plugin: "claim" },
            detail: { holder: clash.run, file: clash.file },
          });
        }

        // On the map: the plan for this scope, then the intent part_of it (the run's open one with the same words grows).
        const facts: Fact[] = [];
        const now = new Date().toISOString();
        let plan = plans.get(scope);
        if (!plan) {
          plan = { id: newId(), title: `Shared plan: ${scopeTitle(scope)}` };
          facts.push(["+", plan.id, "type", PLAN], ["+", plan.id, "status", "doing"], ["+", plan.id, "title", plan.title], ["+", plan.id, "scope", scope]);
          plans.set(scope, plan);
        }
        const mine = openOf(r.run).find((i) => i.scope === scope && i.title.toLowerCase() === intent.toLowerCase());
        let view: IntentView;
        if (mine) {
          const all = [...new Set([...mine.files, ...files])];
          facts.push(...move(mine.id, "files", mine.files, all));
          view = { ...mine, files: all };
        } else {
          const id = newId();
          const branch = branchOf(r);
          view = { id, plan: plan.id, scope, run: r.run, agent: runName(r), title: intent, files, status: "doing", since: now, after: [], ...(branch ? { branch } : {}), ...(r.cwd ? { folder: r.cwd } : {}) };
          if (asked) view = { ...view, asked };
          facts.push(["+", id, "type", INTENT], ["+", id, "status", "doing"], ["+", id, "title", intent], ["+", id, "run", r.run], ["+", id, "agent", view.agent], ["+", id, "files", files], ["+", id, "scope", scope], ["+", id, "since", now]);
          if (asked) facts.push(["+", id, "asked", asked]);
          if (branch) facts.push(["+", id, "branch", branch]);
          if (r.cwd) facts.push(["+", id, "folder", r.cwd]);
          const link = newId();
          facts.push(["+", link, "type", "part_of"], ["+", link, "from", id], ["+", link, "to", plan.id]);
        }
        for (const on of built) {
          if (on === view.id || view.after.includes(on) || !intents.has(on)) continue;
          const link = newId();
          facts.push(["+", link, "type", "depends_on"], ["+", link, "from", view.id], ["+", link, "to", on]);
          view = { ...view, after: [...view.after, on] };
        }
        call.write(facts);
        intents.set(view.id, view);
        // A claim takes over the run's holds on first write of those files.
        loose = loose.filter((h) => !(h.run === r.run && files.some((f) => covers(f, h.file))));
        changed();

        const holding = holdsNow().filter((h) => h.run === r.run).map((h) => h.file);
        if (!merge.size) return { intent: view.id, holding } as unknown as Json;
        const bs = [...merge];
        return { intent: view.id, holding, merge: bs, next: `They let go. Their work is on ${bs.join(", ")}: run ${bs.map((b) => `\`git merge ${b}\``).join(", then ")} now, before you edit, then re-read the files.` } as unknown as Json;
      },
    });

    reg.register({
      name: "claim.drop",
      title: "Let go of files this run holds (all of them, without files)",
      doc: "Takes the files off the run's intents; an intent left with none is done when the run wrote any of them, else dropped.",
      input: { type: "object", properties: { files: { type: "array", items: { type: "string" }, maxItems: 50 } } },
      async run(input: { files?: string[] }, call) {
        const r = runOf(call);
        const files = input.files?.map((f) => norm(f, r.cwd));
        const facts: Fact[] = [];
        const now = new Date().toISOString();
        let dropped = 0;
        for (const i of openOf(r.run)) {
          const left = files ? i.files.filter((f) => !files.includes(f)) : [];
          if (left.length === i.files.length) continue;
          dropped += i.files.length - left.length;
          if (left.length) (facts.push(...move(i.id, "files", i.files, left)), intents.set(i.id, { ...i, files: left }));
          // Let go after writing there: the work is done. Without a write: dropped.
          else facts.push(...close(i, i.files.some((f) => [...(wrote.get(r.run) ?? [])].some((w) => covers(f, w))) ? "done" : "dropped", now));
        }
        const before = loose.length;
        loose = loose.filter((h) => h.run !== r.run || (files && !files.includes(h.file)));
        dropped += before - loose.length;
        if (facts.length) call.write(facts);
        if (dropped) changed();
        return { dropped } as unknown as Json;
      },
    });

    reg.register({
      name: "claim.release",
      title: "A run's turn is over: its intents on the shared plan are done",
      doc: "The claim plugin calls it when a run's reply ends, or the run ends or goes quiet. A run may call it for itself, never for another.",
      input: { type: "object", required: ["run"], properties: { run: { type: "string" } } },
      async run(input: { run: string }, call) {
        if (call.caller.run && call.caller.run !== input.run)
          throw new Refused({ code: "claim.not_yours", message: "A run can end only its own claims: claim.drop lets go of yours.", by: { plugin: "claim" } });
        const now = new Date().toISOString();
        const open = openOf(input.run);
        const facts = open.flatMap((i) => close(i, "done", now));
        if (facts.length) (call.write(facts), trim(), changed());
        return { done: open.length } as unknown as Json;
      },
    });

    ctx.provide<ClaimRead>("claim.read", (_caller, from) => ({
      plan() {
        expire();
        return state();
      },
      watch(on) {
        watchers.add(on);
        const off = () => void watchers.delete(on);
        from.effect(() => off);
        return off;
      },
    }));

    // Unloaded: nobody is left waiting on a plan that is gone.
    ctx.effect(() => () => {
      for (const wake of [...waiting]) wake();
    });

    // A quiet run's holds go even when nobody asks.
    ctx.effect(() => {
      const t = setInterval(expire, 60_000);
      return () => clearInterval(t);
    });
  },
};

export default claim;
