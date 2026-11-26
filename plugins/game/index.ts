/**
 * The game plugin, server side: a situation modelled as a game in normal
 * form, on the map, and reasoned out.
 *
 * - The `game` flavour of question: `players` (each a name and its
 *   strategies) and `payoffs` (what each outcome is worth to each player).
 * - The `plays` link: an actor plays a game, `as` one of its players.
 * - Actions to make and shape one (`game.create`, `game.player`,
 *   `game.strategy`, `game.payoff`, `game.remove`) and to reason it out
 *   (`game.analyze`), which records the analysis as a finding `about` the
 *   game and supersedes the one before.
 *
 * Every change is one change set, undone like any other. The reasoning is
 * analysis.ts, pure.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { FlavourDef, LinkDef, TypesDefine } from "../../spec/types.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { analyze, readGame, tooBig, type Cell, type Game, type Player } from "./analysis.ts";

export const GAME: FlavourDef = {
  name: "game",
  base: "question",
  doc: "A situation as a game: who plays, what each can do, and what each outcome is worth to each.",
  trial: true,
  fields: {
    players: { kind: "json", doc: "The players in order, each { name, strategies }." },
    payoffs: { kind: "json", doc: "Each outcome's worth: { profile, payoff }, a strategy and a number per player, in player order." },
  },
};

export const PLAYS: LinkDef = {
  name: "plays",
  doc: "Takes part in a game, as one of its players.",
  from: ["actor"],
  to: ["question"],
  fields: { as: { kind: "text", doc: "The player's name in the game." } },
};

/** What `game.analyze` records its findings as: a record of this kind, its value naming the game and the action. */
export const FINDING = "finding";
export const BY = "game.analyze";

const refuse = (code: string, message: string): never => {
  throw new Refused({ code: `game.${code}`, message, by: { plugin: "game" } });
};

const newId = () => `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const today = () => new Date().toISOString().slice(0, 10);

const isObj = (v: Json | undefined): v is { [k: string]: Json } => !!v && typeof v === "object" && !Array.isArray(v);

/** The facts that move one field from `old` to `now`. */
const move = (id: Id, field: string, old: Json | undefined, now: Json | undefined): Fact[] => {
  if (JSON.stringify(old) === JSON.stringify(now)) return [];
  return [...(old !== undefined ? [["-", id, field, old] as Fact] : []), ...(now !== undefined ? [["+", id, field, now] as Fact] : [])];
};

const asJson = (g: Game) => ({ players: g.players as unknown as Json, payoffs: g.payoffs as unknown as Json });

/** A profile or payoff given as a list in player order or as an object by player name, as a list. */
function byPlayer<T>(players: Player[], v: Json, what: string, ok: (x: Json) => x is T & Json): T[] {
  const list = Array.isArray(v) ? v : isObj(v) ? players.map((p) => (p.name in v ? v[p.name]! : null)) : null;
  const named = players.map((p) => p.name).join(", ");
  if (!list) return refuse("cell", `A ${what} is a list in player order (${named}) or an object by player name.`);
  if (isObj(v)) {
    const extra = Object.keys(v).filter((k) => !players.some((p) => p.name === k));
    if (extra.length) refuse("player_unknown", `No player ${extra.join(", ")} in this game. Its players: ${named}.`);
  }
  if (list.length !== players.length) refuse("cell", `A ${what} has one entry per player (${named}); this has ${list.length}.`);
  list.forEach((x, i) => {
    if (!ok(x)) refuse("cell", `The ${what} for ${players[i]!.name} is ${JSON.stringify(x)}, which won't do.`);
  });
  return list as T[];
}

const NAME = { type: "string", description: "A name unique among the game's players." };
const STRATEGIES = { type: "array", items: { type: "string" }, description: "What the player can do, each a few words." };
const CELLS = {
  type: "array",
  description:
    'Outcomes and their worth. Each { profile, payoff }: profile is the strategy each player picks, payoff the number each gets, both as a list in player order (["Defect", "Cooperate"], [0, -3]) or an object by player name ({ "Ann": "Defect", "Bo": "Cooperate" }). Higher is better.',
  items: {
    type: "object",
    properties: { profile: { type: ["array", "object"] }, payoff: { type: ["array", "object"] } },
    required: ["profile", "payoff"],
  },
};

const game: Plugin = {
  id: "game",
  about: "Games: a situation modelled as players, strategies and payoffs, and reasoned out to its equilibria.",
  inject: ["types.define", "action.register", "graph.read"],
  apply(ctx: Context) {
    const define = ctx.get<TypesDefine>("types.define");
    define.flavour(GAME);
    define.link(PLAYS);
    const register = ctx.get<ActionRegister>("action.register");
    const graph = ctx.get<GraphRead>("graph.read");

    /** A game on the map, with its players and payoffs read. */
    const load = async (id: Id): Promise<{ item: Item; game: Game }> => {
      if (typeof id !== "string") return refuse("missing", "Name the game by its id.");
      const [item] = await graph.get([id]);
      if (!item) return refuse("missing", `There is no item ${id}.`);
      if (item.type !== GAME.name) return refuse("not_a_game", `${id} is a ${item.type}, not a game. Make one with game.create.`);
      const { players, payoffs } = readGame(item.fields);
      return { item, game: { players, payoffs } };
    };
    /** The facts that put `next` on the game in place of what it holds. */
    const write = (item: Item, next: Game): Fact[] => {
      const big = tooBig(next.players);
      if (big) refuse("too_big", big);
      const j = asJson(next);
      return [...move(item.id, "players", item.fields.players, j.players), ...move(item.id, "payoffs", item.fields.payoffs, j.payoffs)];
    };
    const playerOf = (g: Game, name: string): Player =>
      g.players.find((p) => p.name === name) ?? refuse("player_unknown", `No player ${name}. The players: ${g.players.map((p) => p.name).join(", ") || "none yet"}.`);
    /** A plays link from an actor to the game, checked. */
    const plays = async (actor: Id, gameId: Id, as: string): Promise<Fact[]> => {
      const [a] = await graph.get([actor]);
      if (!a || a.type !== "actor") refuse("actor", `${actor} is not an actor on the map. Make one with items.create { type: "actor" }, or leave actor out.`);
      const id = newId();
      return [["+", id, "type", PLAYS.name], ["+", id, "from", actor], ["+", id, "to", gameId], ["+", id, "as", as]];
    };
    /** Sets cells on a game: each replaces the one for its profile. */
    const setCells = (g: Game, cells: Json[]): Game => {
      if (!g.players.length) refuse("no_players", "Add the players and their strategies before their payoffs.");
      const payoffs = [...g.payoffs];
      for (const c of cells) {
        if (!isObj(c)) return refuse("cell", "Each cell is { profile, payoff }.");
        const profile = byPlayer<string>(g.players, c.profile!, "profile", (x): x is string => typeof x === "string");
        profile.forEach((s, i) => {
          if (!g.players[i]!.strategies.includes(s)) refuse("strategy_unknown", `${g.players[i]!.name} has no strategy ${s}. It has: ${g.players[i]!.strategies.join(", ") || "none yet"}.`);
        });
        const payoff = byPlayer<number>(g.players, c.payoff!, "payoff", (x): x is number => typeof x === "number" && Number.isFinite(x));
        const key = JSON.stringify(profile);
        const at = payoffs.findIndex((p) => JSON.stringify(p.profile) === key);
        const cell: Cell = { profile, payoff };
        if (at >= 0) payoffs[at] = cell;
        else payoffs.push(cell);
      }
      return { ...g, payoffs };
    };
    const validPlayers = (given: Json[] | undefined): Player[] => {
      const out: Player[] = [];
      for (const p of given ?? []) {
        if (!isObj(p) || typeof p.name !== "string" || !p.name.trim()) return refuse("player", "Each player is { name, strategies?, actor? }.");
        if (out.some((q) => q.name === p.name)) refuse("taken", `Two players named ${p.name}.`);
        out.push({ name: p.name, strategies: strategiesOf(p.strategies, p.name) });
      }
      return out;
    };
    const strategiesOf = (v: Json | undefined, who: string): string[] => {
      const s = v === undefined ? [] : Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim()) ? (v as string[]) : refuse("strategy", `${who}'s strategies are a list of names.`);
      if (new Set(s).size !== s.length) refuse("taken", `${who} has a strategy named twice.`);
      return s;
    };

    register.register({
      name: "game.create",
      title: "Model a situation as a game",
      input: {
        type: "object",
        properties: {
          title: { type: "string", description: "The situation, in a few words." },
          note: { type: "string", description: "What the game models and what it leaves out." },
          players: {
            type: "array",
            description: "The players in order (the first is the matrix's rows, the second its columns).",
            items: {
              type: "object",
              properties: { name: NAME, strategies: STRATEGIES, actor: { type: "string", description: "An actor on the map this player is: linked plays." } },
              required: ["name"],
            },
          },
          payoffs: CELLS,
          part_of: { type: "string", description: "An item the game is part of." },
        },
        required: ["title"],
      },
      async run(input: { title: string; note?: string; players?: Json[]; payoffs?: Json[]; part_of?: Id }, call: ActionContext) {
        if (!input.title.trim()) refuse("title", "A game needs a title.");
        const id = newId();
        const players = validPlayers(input.players);
        const g = input.payoffs?.length ? setCells({ players, payoffs: [] }, input.payoffs) : { players, payoffs: [] };
        const facts: Fact[] = [["+", id, "type", GAME.name], ["+", id, "status", "open"], ["+", id, "title", input.title]];
        if (input.note) facts.push(["+", id, "note", input.note]);
        facts.push(...write({ id, type: GAME.name, fields: {} }, g));
        for (const p of input.players ?? []) if (isObj(p) && typeof p.actor === "string") facts.push(...(await plays(p.actor, id, String(p.name))));
        if (input.part_of) {
          const [whole] = await graph.get([input.part_of]);
          if (!whole || typeof whole.fields.from === "string") refuse("missing", `There is no item ${input.part_of} to be part of.`);
          const link = newId();
          facts.push(["+", link, "type", "part_of"], ["+", link, "from", id], ["+", link, "to", input.part_of]);
        }
        call.write(facts);
        return { id, players: players.map((p) => p.name) };
      },
    });

    register.register({
      name: "game.player",
      title: "Add a player to a game",
      input: {
        type: "object",
        properties: {
          game: { type: "string" },
          name: NAME,
          strategies: STRATEGIES,
          actor: { type: "string", description: "An actor on the map this player is: linked plays." },
          clear: { type: "boolean", description: "A new player changes every outcome, so payoffs set already are cleared; say true to allow it." },
        },
        required: ["game", "name"],
      },
      async run(input: { game: Id; name: string; strategies?: string[]; actor?: Id; clear?: boolean }, call: ActionContext) {
        const { item, game: g } = await load(input.game);
        if (!input.name.trim()) refuse("player", "A player needs a name.");
        if (g.players.some((p) => p.name === input.name)) refuse("taken", `${input.name} plays already. Add strategies with game.strategy.`);
        if (g.payoffs.length && !input.clear) refuse("shape", `The game has ${g.payoffs.length} payoffs set; a new player clears them. Say clear: true to go on.`);
        const next = { players: [...g.players, { name: input.name, strategies: strategiesOf(input.strategies, input.name) }], payoffs: [] };
        call.write([...write(item, next), ...(input.actor ? await plays(input.actor, item.id, input.name) : [])]);
        return { game: item.id, players: next.players.map((p) => p.name) };
      },
    });

    register.register({
      name: "game.strategy",
      title: "Add strategies to a player",
      input: {
        type: "object",
        properties: { game: { type: "string" }, player: { type: "string" }, strategies: STRATEGIES },
        required: ["game", "player", "strategies"],
      },
      async run(input: { game: Id; player: string; strategies: string[] }, call: ActionContext) {
        const { item, game: g } = await load(input.game);
        const p = playerOf(g, input.player);
        const add = strategiesOf(input.strategies, p.name);
        const taken = add.filter((s) => p.strategies.includes(s));
        if (taken.length) refuse("taken", `${p.name} has ${taken.join(", ")} already.`);
        const next = { ...g, players: g.players.map((q) => (q === p ? { ...q, strategies: [...q.strategies, ...add] } : q)) };
        call.write(write(item, next));
        return { game: item.id, strategies: [...p.strategies, ...add] };
      },
    });

    register.register({
      name: "game.payoff",
      title: "Set what outcomes are worth",
      input: { type: "object", properties: { game: { type: "string" }, cells: CELLS }, required: ["game", "cells"] },
      async run(input: { game: Id; cells: Json[] }, call: ActionContext) {
        const { item, game: g } = await load(input.game);
        const next = setCells(g, input.cells);
        call.write(write(item, next));
        const a = analyze(next);
        return { game: item.id, set: input.cells.length, missing: a.complete ? 0 : a.missing.length };
      },
    });

    register.register({
      name: "game.remove",
      title: "Take a strategy or a player out of a game",
      input: {
        type: "object",
        properties: {
          game: { type: "string" },
          player: { type: "string" },
          strategy: { type: "string", description: "The strategy to take out, with the payoffs that use it. Absent: the player goes, with its plays links." },
          clear: { type: "boolean", description: "Taking a player out clears the payoffs set; say true to allow it." },
        },
        required: ["game", "player"],
      },
      async run(input: { game: Id; player: string; strategy?: string; clear?: boolean }, call: ActionContext) {
        const { item, game: g } = await load(input.game);
        const p = playerOf(g, input.player);
        const i = g.players.indexOf(p);
        if (input.strategy !== undefined) {
          if (!p.strategies.includes(input.strategy)) refuse("strategy_unknown", `${p.name} has no strategy ${input.strategy}. It has: ${p.strategies.join(", ")}.`);
          const next = {
            players: g.players.map((q) => (q === p ? { ...q, strategies: q.strategies.filter((s) => s !== input.strategy) } : q)),
            payoffs: g.payoffs.filter((c) => c.profile[i] !== input.strategy),
          };
          call.write(write(item, next));
          return { game: item.id, removed: input.strategy };
        }
        if (g.payoffs.length && !input.clear) refuse("shape", `The game has ${g.payoffs.length} payoffs set; taking a player out clears them. Say clear: true to go on.`);
        const facts = write(item, { players: g.players.filter((q) => q !== p), payoffs: [] });
        const links = await graph.links(item.id, { type: PLAYS.name, dir: "in" }, { limit: LIMIT_MAX });
        for (const l of links.items) {
          if (l.fields.as !== p.name) continue;
          facts.push(["-", l.id, "type", l.type]);
          for (const [k, v] of Object.entries(l.fields)) facts.push(["-", l.id, k, v]);
        }
        call.write(facts);
        return { game: item.id, removed: p.name };
      },
    });

    register.register({
      name: "game.rename",
      title: "Rename a player or a strategy, keeping the payoffs",
      input: {
        type: "object",
        properties: {
          game: { type: "string" },
          player: { type: "string" },
          strategy: { type: "string", description: "The player's strategy to rename. Absent: the player is renamed, with its plays links." },
          to: { type: "string", description: "The new name." },
        },
        required: ["game", "player", "to"],
      },
      async run(input: { game: Id; player: string; strategy?: string; to: string }, call: ActionContext) {
        const { item, game: g } = await load(input.game);
        const p = playerOf(g, input.player);
        const i = g.players.indexOf(p);
        const to = input.to.trim();
        if (!to) refuse("name", "Say the new name in to.");
        if (input.strategy !== undefined) {
          if (!p.strategies.includes(input.strategy)) refuse("strategy_unknown", `${p.name} has no strategy ${input.strategy}. It has: ${p.strategies.join(", ")}.`);
          if (to === input.strategy) return { game: item.id, renamed: to };
          if (p.strategies.includes(to)) refuse("taken", `${p.name} has ${to} already.`);
          const next = {
            players: g.players.map((q) => (q === p ? { ...q, strategies: q.strategies.map((s) => (s === input.strategy ? to : s)) } : q)),
            payoffs: g.payoffs.map((c) => (c.profile[i] === input.strategy ? { ...c, profile: c.profile.map((s, j) => (j === i ? to : s)) } : c)),
          };
          call.write(write(item, next));
          return { game: item.id, renamed: to };
        }
        if (to === p.name) return { game: item.id, renamed: to };
        if (g.players.some((q) => q.name === to)) refuse("taken", `${to} plays already.`);
        const facts = write(item, { ...g, players: g.players.map((q) => (q === p ? { ...q, name: to } : q)) });
        const links = await graph.links(item.id, { type: PLAYS.name, dir: "in" }, { limit: LIMIT_MAX });
        for (const l of links.items) if (l.fields.as === p.name) facts.push(["-", l.id, "as", p.name], ["+", l.id, "as", to]);
        call.write(facts);
        return { game: item.id, renamed: to };
      },
    });

    register.register({
      name: "game.analyze",
      title: "Reason a game out",
      input: {
        type: "object",
        properties: {
          game: { type: "string" },
          record: { type: "boolean", description: "Keep the analysis on the map as a finding about the game (default true). False only answers." },
        },
        required: ["game"],
      },
      async run(input: { game: Id; record?: boolean }, call: ActionContext) {
        const { item, game: g } = await load(input.game);
        const a = analyze(g);
        if (input.record === false || !a.complete) return { ...a, recorded: null };
        const value = { by: BY, game: item.id, ...a } as unknown as Json;
        // The findings it made before, still current: the newest is kept if it says the same, else all are superseded.
        const about = await graph.links(item.id, { type: "about", dir: "in" }, { limit: LIMIT_MAX });
        const from = about.items.map((l) => l.from).slice(0, LIMIT_MAX);
        const before = (await graph.get(from)).filter(
          (r): r is Item => !!r && r.type === "record" && r.fields.status === "current" && isObj(r.fields.value) && r.fields.value.by === BY && r.fields.value.game === item.id,
        );
        const same = before.find((r) => JSON.stringify(r.fields.value) === JSON.stringify(value));
        if (same) return { ...a, recorded: same.id };
        const id = newId();
        const facts: Fact[] = [
          ["+", id, "type", "record"],
          ["+", id, "status", "current"],
          ["+", id, "title", `${String(item.fields.title ?? item.id)}: ${a.nash.length ? `equilibria ${a.nash.map((e) => `(${e.profile.join(", ")})`).join(" ")}` : "no pure equilibrium"}`],
          ["+", id, "kind", FINDING],
          ["+", id, "note", a.summary.map((l) => `- ${l}`).join("\n")],
          ["+", id, "value", value],
          ["+", id, "as_of", today()],
        ];
        const link = newId();
        facts.push(["+", link, "type", "about"], ["+", link, "from", id], ["+", link, "to", item.id]);
        for (const r of before) facts.push(["-", r.id, "status", "current"], ["+", r.id, "status", "superseded"]);
        call.write(facts);
        return { ...a, recorded: id, superseded: before.map((r) => r.id) };
      },
    });
  },
};

export default game;
