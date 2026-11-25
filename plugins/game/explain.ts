/**
 * The explain plugin, server side: a game's analysis said in plain words
 * by a model, kept on the map beside it.
 *
 * - The `explanation` flavour of record: what a model said a game means,
 *   at a version of the game, with a person's accept or reject.
 * - `explain.game`: asks the configured model through `typed.ask` (so it is
 *   a call, recorded as a run, and what the map's nodes say at
 *   `game:explain` is in its system prompt), keeps the explanation `about`
 *   the game, and supersedes the one before.
 *   A call may name its model (`model`, a spec such as
 *   `anthropic:claude-sonnet-5-5`), which goes to `typed.ask` as it is;
 *   `typed.models` says which are offered.
 * - `explain.decide`: a person's accepted or rejected, at the explanation's
 *   version. The call follows the explanation, so the decision judges the
 *   nodes that were said to it.
 *
 * Apart from the game plugin, so games work on a server with no model.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { FlavourDef, TypesDefine } from "../../spec/types.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { TypedAsk } from "../typed/index.ts";
import { analyze, readGame, versionOf, type Analysis, type Game } from "./analysis.ts";

export const EXPLANATION: FlavourDef = {
  name: "explanation",
  base: "record",
  doc: "What a model said something on the map means, in plain words, with a person's accept or reject.",
  trial: true,
  fields: {
    version: { kind: "text", doc: "The version of what it explains (a game's players and payoffs, hashed)." },
    decision: { kind: "choice", values: ["accepted", "rejected"], doc: "A person's word on it." },
    decided_version: { kind: "text", doc: "The version the decision was made at." },
    model: { kind: "text", doc: "The model that said it, when the call chose one (anthropic:<model>, claude)." },
  },
};

/** Where the map speaks to the model: nodes listening here set its voice. */
export const PLACE = "game:explain";

/** The voice it starts with; nodes at game:explain say more, and win where they differ. */
export const SYSTEM = [
  "You explain a game-theoretic model of a real situation to the people in it, who are not game theorists.",
  "Use the players' names and the situation's own words, never the jargon alone: say what 'dominated' or 'equilibrium' means here, in a clause.",
  "Say what each side is likely to do and why, where the tension is, and what would have to change for a better outcome. Be concrete and brief.",
  "Trust the analysis given: it is computed, not guessed. If the model leaves something out that matters, say so in one sentence.",
  "The title is the takeaway in one line. The note is two to four short paragraphs of Markdown.",
].join("\n");

const refuse = (code: string, message: string, detail?: Json): never => {
  throw new Refused({ code: `explain.${code}`, message, by: { plugin: "explain" }, ...(detail !== undefined ? { detail } : {}) });
};

/**
 * A misfit, said so that whoever hears it (the agent that called, or the
 * one told of a person's call) can suggest a fix: what failed, where the raw
 * replies are, and the three fixes there are.
 */
export function misfitText(run: string, model: string | undefined, attempts: number, problems: string[]): string {
  return [
    `The model's explanation didn't fit the map after ${attempts} attempt${attempts === 1 ? "" : "s"}${model ? ` (${model})` : ""}: ${problems.join("; ")}`,
    `Its raw replies: act typed.get { "run": "${run}" }.`,
    "Fixes: a reply right in content but wrong in wrapper is the typed check's to take (itemsOf in plugins/typed/shape.ts); a reply wrong in content wants other words at game:explain (a node there) or another model (explain.game's model).",
  ].join("\n");
}

const today = () => new Date().toISOString().slice(0, 10);

/** What the model is told about a game: the situation, the matrix and the analysis. */
export function promptOf(title: string, note: string | undefined, game: Game, a: Analysis, actors: Record<string, string>): string {
  const who = game.players.map((p) => `- ${p.name}${actors[p.name] ? ` (on the map: ${actors[p.name]})` : ""}: can ${p.strategies.join(" or ")}`);
  const cells = game.payoffs.map((c) => `- ${c.profile.map((s, i) => `${game.players[i]!.name} ${s}`).join(", ")} → ${c.payoff.map((x, i) => `${game.players[i]!.name} ${x}`).join(", ")}`);
  return [
    `The situation: ${title}`,
    ...(note ? [note] : []),
    "",
    "The players and what each can do:",
    ...who,
    "",
    "What each outcome is worth to each player (higher is better for that player):",
    ...cells,
    "",
    "The analysis:",
    ...a.summary.map((l) => `- ${l}`),
    "",
    "Explain what this means for the people in it, as one explanation.",
  ].join("\n");
}

/** Its config: a model of its own, for a call that names none, in place of the typed plugin's configured one. */
export interface ExplainConfig {
  model?: string;
}

const explain: Plugin = {
  id: "explain",
  about: "Explanations: a game's analysis said in plain words by a model, kept beside it, accepted or rejected by a person.",
  inject: ["types.define", "action.register", "graph.read", "typed.ask"],
  apply(ctx: Context, config: ExplainConfig = {}) {
    ctx.get<TypesDefine>("types.define").flavour(EXPLANATION);
    const register = ctx.get<ActionRegister>("action.register");
    const graph = ctx.get<GraphRead>("graph.read");
    const typed = ctx.get<TypedAsk>("typed.ask");

    const one = async (id: Id, type: string): Promise<Item> => {
      if (typeof id !== "string") return refuse("missing", "Name it by its id.");
      const [item] = await graph.get([id]);
      if (!item) return refuse("missing", `There is no item ${id}.`);
      if (item.type !== type) return refuse("not_a_" + type, `${id} is a ${item.type}, not a ${type}.`);
      return item;
    };

    register.register({
      name: "explain.game",
      title: "Explain a game in plain words",
      input: {
        type: "object",
        properties: {
          game: { type: "string" },
          model: {
            type: "string",
            description: `The model to ask, as a spec: anthropic:<model> (its key in ANTHROPIC_API_KEY on the server), openai:<model>, or claude[:<model>] (the Claude Code CLI). Passed to typed.ask; absent, the server's configured model. typed.models lists those offered.`,
          },
          parent: {
            type: "string",
            description: "The run the call belongs under: the agent session a person is working with, from the page. Absent: the caller's own run (an agent's, through act), else the plugin's own run of calls.",
          },
        },
        required: ["game"],
      },
      async run(input: { game: Id; model?: string; parent?: string }, call: ActionContext) {
        const item = await one(input.game, "game");
        const chosen = input.model?.trim() || config.model;
        const parent = input.parent?.trim() || call.caller.run;
        const g = readGame(item.fields);
        const game = { players: g.players, payoffs: g.payoffs };
        const a = analyze(game);
        if (!a.complete) refuse("incomplete", a.summary[0] ?? "The game isn't complete yet.");
        const version = versionOf(game);
        const near = await graph.links(item.id, { dir: "in" }, { limit: LIMIT_MAX });
        const ends = (await graph.get(near.items.map((l) => l.from).slice(0, LIMIT_MAX))) as (Item | null)[];
        const byId = new Map(ends.filter((x): x is Item => !!x).map((x) => [x.id, x]));
        const actors: Record<string, string> = {};
        for (const l of near.items) if (l.type === "plays" && typeof l.fields.as === "string") actors[l.fields.as] = String(byId.get(l.from)?.fields.title ?? l.from);
        const before = near.items
          .filter((l) => l.type === "about")
          .map((l) => byId.get(l.from))
          .filter((x): x is Item => !!x && x.type === EXPLANATION.name && x.fields.status === "current");
        const prompt = promptOf(String(item.fields.title ?? item.id), typeof item.fields.note === "string" ? item.fields.note : undefined, game, a, actors);
        const out = await typed.ask({
          type: EXPLANATION.name,
          title: `Explain ${String(item.fields.title ?? item.id)}`,
          prompt,
          system: SYSTEM,
          places: [PLACE],
          fields: ["title", "note"],
          links: [],
          set: { version, as_of: today(), ...(chosen ? { model: chosen } : {}) },
          attach: [{ type: "about", to: item.id }],
          follow: { made: true, version },
          subject: { type: "game", tokens: Math.ceil(prompt.length / 4) },
          ...(chosen ? { model: chosen } : {}),
          ...(parent ? { parent } : {}),
          // Who asked, so a person's failed call can be told to the agent they work with (plugins/since).
          facts: { asked_by: call.caller.actor?.id ?? call.caller.plugin, asked_kind: call.caller.actor?.kind ?? "plugin", about: item.id },
        });
        if (!out.ok) return refuse("misfit", misfitText(out.run, chosen, out.attempts, out.problems.map((p) => p.message)), { run: out.run, attempts: out.attempts, problems: out.problems as unknown as Json, ...(chosen ? { model: chosen } : {}) });
        const facts: Fact[] = [...out.facts];
        for (const r of before) facts.push(["-", r.id, "status", "current"], ["+", r.id, "status", "superseded"]);
        call.write(facts);
        const id = Object.values(out.ids)[0]!;
        const title = out.facts.find((f) => f[1] === id && f[2] === "title")?.[3] ?? "";
        const note = out.facts.find((f) => f[1] === id && f[2] === "note")?.[3] ?? "";
        return { id, run: out.run, title, note, version, ...(chosen ? { model: chosen } : {}), superseded: before.map((r) => r.id) } as unknown as Json;
      },
    });

    register.register({
      name: "explain.decide",
      title: "Accept or reject an explanation",
      input: {
        type: "object",
        properties: { explanation: { type: "string" }, decision: { type: "string", enum: ["accepted", "rejected"] } },
        required: ["explanation", "decision"],
      },
      async run(input: { explanation: Id; decision: "accepted" | "rejected" }, call: ActionContext) {
        const item = await one(input.explanation, EXPLANATION.name);
        const version = item.fields.version;
        if (typeof version !== "string") return refuse("version", `${item.id} has no version to decide at.`);
        const facts: Fact[] = [];
        for (const [k, v] of [["decision", input.decision], ["decided_version", version]] as const) {
          const old = item.fields[k];
          if (old === v) continue;
          if (old !== undefined) facts.push(["-", item.id, k, old]);
          facts.push(["+", item.id, k, v]);
        }
        call.write(facts);
        return { explanation: item.id, decision: input.decision };
      },
    });
  },
};

export default explain;
