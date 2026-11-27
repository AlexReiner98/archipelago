/**
 * The shared plan, as plain data: which live run holds which file, and the
 * writes a hold turned away. No runtime, so a test or the page can use it.
 *
 * On the map a plan is an item of the flavour `plan` (one per repository or
 * folder), and each agent's claim an `intent` part_of it: its files, its
 * branch, and whether it is held, done or dropped. An intent that waited for
 * another depends_on it: it was built on that one.
 */
import type { Id, Json } from "../../spec/common.ts";
import type { Item } from "../../spec/graph.ts";

/** The flavours the claim plugin keeps the plan as. */
export const PLAN = "plan";
export const INTENT = "intent";

/** One file held by one run. */
export interface Hold {
  /** Where the file is: the run's repository (`repo:host/owner/name`) when it has one, else its folder. */
  scope: string;
  /** The path, relative to the scope, with `/`. A path ending in `/` holds everything under it. */
  file: string;
  run: string;
  /** The run's name, as people see it. */
  title: string;
  /** What the run means to do there, in its own words. */
  intent: string;
  /** Taken by the agent (`claim.take`), or on its first write. */
  how: "claimed" | "on_write";
  since: string;
  /** The run's git branch, when its folder is a checkout: another checkout gets its change only by merging it. */
  branch?: string;
  /** The run's folder, to tell a hold in another checkout from one in the same. */
  where?: string;
  /** The intent on the map this hold is part of; none for a hold on first write. */
  item?: Id;
  /** Its run has not been heard by this server (it restarted since the claim): the hold goes on its own soon, and anyone may end it. */
  unheard?: true;
}

/** A write turned away because another run held the file. */
export interface Turned {
  scope: string;
  file: string;
  /** The run that tried. */
  run: string;
  title: string;
  /** The run that holds it. */
  holder: string;
  holder_title: string;
  intent: string;
  tool: string;
  time: string;
}

/** A run waiting in `claim.take` for files another run holds. */
export interface Wait {
  scope: string;
  run: string;
  title: string;
  files: string[];
  intent: string;
  since: string;
  branch?: string;
}

/** One agent's claim, as the map keeps it. */
export interface IntentView {
  id: Id;
  /** Its plan's id. */
  plan?: Id;
  scope: string;
  run: string;
  /** The run's name, as people see it. */
  agent: string;
  /** What it means to do: the intent's title. */
  title: string;
  branch?: string;
  folder?: string;
  files: string[];
  /** `doing` while held; `done` when its run ended; `dropped` when let go. */
  status: string;
  /** When it was first asked for, when it waited for another run to let go. */
  asked?: string;
  since: string;
  ended?: string;
  /** The intents it waited for and built on (depends_on). */
  after: Id[];
}

/** A plan: the intents of the agents on one repository or folder, the latest last. */
export interface PlanView {
  id: Id;
  scope: string;
  title: string;
  intents: IntentView[];
}

/** What the page key `claim.plan` holds. */
export interface PlanState {
  /** The plans with intents, the latest first. */
  plans: PlanView[];
  holds: Hold[];
  /** Runs queued for held files, the longest waiting first. */
  waits: Wait[];
  /** The latest first, at most TURNED_KEEP. */
  turned: Turned[];
  /** Every write turned away since the plugin loaded. */
  prevented: number;
}

export const TURNED_KEEP = 50;

/** A scope that is a repository, not a folder: `repo:host/owner/name`. */
export const REPO = "repo:";

/** The tools that write the file they name. A read of a held file is told, never turned away. */
export const WRITES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** A path as the map keeps it: `/`, no leading `./`, relative to the folder when it was absolute inside it. */
export function norm(path: string, cwd?: string): string {
  let p = path.trim().replaceAll("\\", "/");
  const base = cwd?.replaceAll("\\", "/").replace(/\/+$/, "");
  if (base && p.toLowerCase().startsWith(base.toLowerCase() + "/")) p = p.slice(base.length + 1);
  while (p.startsWith("./")) p = p.slice(2);
  return p;
}

/** Whether a hold on `held` covers `file`: the same path, or a folder (ending `/`) holding it. Either way round for two holds. */
export function covers(held: string, file: string): boolean {
  if (held === file) return true;
  if (held.endsWith("/") && file.startsWith(held)) return true;
  if (file.endsWith("/") && held.startsWith(file)) return true;
  return false;
}

/** Whether a path is absolute: `/…`, or a drive (`C:/…`). */
const absolute = (p: string) => /^(\/|[a-z]:\/)/i.test(p);

/**
 * A file's absolute path, from its path and the folder of the run that named
 * it, to compare across repositories: `/`, no trailing `/` on the folder, and
 * a drive path in lower case (Windows doesn't tell `C:/A` from `c:/a`). None
 * when neither is absolute.
 */
export function absOf(file: string, where?: string): string | undefined {
  const f = file.replaceAll("\\", "/");
  const p = absolute(f) ? f : where && absolute(where.replaceAll("\\", "/")) ? `${where.replaceAll("\\", "/").replace(/\/+$/, "")}/${f}` : undefined;
  return p && /^[a-z]:\//i.test(p) ? p.toLowerCase() : p;
}

/**
 * The hold of another run that covers this file, if any: in this scope by its
 * path there, or in any scope by its absolute path. A file outside the run's
 * repository is held in that run's plan by its absolute path, while a run in
 * the file's own repository names it by a relative one: the absolute path is
 * what the two share.
 */
export function heldByOther(holds: Hold[], scope: string, file: string, run: string, abs?: string): Hold | undefined {
  return holds.find((h) => {
    if (h.run === run) return false;
    if (h.scope === scope && covers(h.file, file)) return true;
    const held = abs ? absOf(h.file, h.where) : undefined;
    return !!held && covers(held, abs!);
  });
}

/** The plan as one block of words for an agent: what the other runs hold, by run. Empty when nobody else holds anything. */
export function planWords(holds: Hold[], scope: string, run: string, cwd?: string): string {
  const others = new Map<string, Hold[]>();
  // Holds in another repository's plan on files in this run's folder count too.
  const here = cwd ? absOf("", cwd) : undefined;
  for (const h of holds) {
    const mine = h.scope === scope || (!!here && !!absOf(h.file, h.where)?.startsWith(here));
    if (!mine || h.run === run) continue;
    others.set(h.run, [...(others.get(h.run) ?? []), h]);
  }
  if (!others.size) return "";
  const lines = [...others.values()].map((hs) => {
    const intents = [...new Set(hs.map((h) => h.intent).filter(Boolean))];
    const on = hs[0]!.branch ? ` on branch ${hs[0]!.branch}` : "";
    const unheard = hs[0]!.unheard ? ` [not heard since the map restarted: it ends on its own, or act claim.release {"run": "${hs[0]!.run}"}]` : "";
    return `- ${hs[0]!.title}${on}: ${hs.map((h) => h.file).join(", ")}${intents.length ? ` (${intents.join("; ")})` : ""}${unheard}`;
  });
  return `Other agents are working in this ${scope.startsWith(REPO) ? "repository" : "folder"} now. The shared plan, what each holds:\n${lines.join("\n")}\nDon't edit those files; pick work that doesn't touch them, or say what you need from them.`;
}

/** A scope as people read it: a repository's owner/name, or a folder's last part. */
export function scopeTitle(scope: string): string {
  if (scope.startsWith(REPO)) return scope.slice(REPO.length).split("/").slice(1).join("/") || scope.slice(REPO.length);
  return scope.replace(/\/+$/, "").split("/").pop() || scope;
}

const str = (v: Json | undefined) => (typeof v === "string" ? v : undefined);

/** An intent item read as a view; undefined when it isn't one. */
export function intentOf(item: Item | null | undefined, after: Id[] = [], plan?: Id): IntentView | undefined {
  if (!item || item.type !== INTENT) return undefined;
  const f = item.fields;
  const files = Array.isArray(f.files) ? f.files.filter((x): x is string => typeof x === "string") : [];
  return {
    id: item.id,
    ...(plan ? { plan } : {}),
    scope: str(f.scope) ?? "",
    run: str(f.run) ?? "",
    agent: str(f.agent) ?? str(f.run) ?? "agent",
    title: str(f.title) ?? "",
    ...(str(f.branch) ? { branch: str(f.branch) } : {}),
    ...(str(f.folder) ? { folder: str(f.folder) } : {}),
    files,
    status: str(f.status) ?? "doing",
    ...(str(f.asked) ? { asked: str(f.asked) } : {}),
    since: str(f.since) ?? "",
    ...(str(f.ended) ? { ended: str(f.ended) } : {}),
    after,
  };
}

/** Idle time that ends a round of work on a plan, ms. */
export const ROUND_GAP = 2 * 60_000;

/** A stretch of a plan when agents worked on it together: intents whose times overlap or follow within ROUND_GAP. */
export interface Round {
  start: number;
  end: number;
  intents: IntentView[];
}

/** A plan's intents in rounds, the earliest first. An intent still held runs to `now`. */
export function rounds(intents: IntentView[], now: number, gap = ROUND_GAP): Round[] {
  const span = (i: IntentView): [number, number] => [Date.parse(i.asked ?? i.since), i.ended ? Date.parse(i.ended) : i.status === "doing" ? now : Date.parse(i.since)];
  const sorted = [...intents].sort((a, b) => span(a)[0] - span(b)[0]);
  const out: Round[] = [];
  for (const i of sorted) {
    const [a, b] = span(i);
    const last = out[out.length - 1];
    if (last && a <= last.end + gap) (last.intents.push(i), (last.end = Math.max(last.end, b)));
    else out.push({ start: a, end: b, intents: [i] });
  }
  return out;
}
