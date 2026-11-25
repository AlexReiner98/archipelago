# game

A situation modelled on the map as a game, so people and agents can reason
it out together: who the players are, what each can do, what each outcome
is worth to each, and what follows from that. The reasoning is kept on the
map as a finding about the game, and like every change it can be undone.

| File | Runs | What it is |
|---|---|---|
| [analysis.ts](analysis.ts) | both | The reasoning, pure: a game in, an analysis out |
| [index.ts](index.ts) | server | The `game` flavour, the `plays` link and the actions. Injects `types.define`, `action.register`, `graph.read` |
| [explain.ts](explain.ts) | server | The game in plain words from a model: the `explanation` flavour, `explain.game`, `explain.decide` (below) |
| [view.ts](view.ts) | page | The view Games and the matrix on a game's item page. Injects `find.index`, `here.read`, `here.set`, `slot.fill`, `action.invoke` |

## On the map

| Type | Is | Fields |
|---|---|---|
| `game` | a flavour of `question`, on trial: open until decided or dropped | `players`: `[{ name, strategies }]` in order; `payoffs`: `[{ profile, payoff }]`, a strategy and a number per player, in player order |
| `plays` | a link from an `actor` to a game | `as`: the player's name |

A game is a question because it is something to decide: when it is,
`items.set` its `status`, `outcome` and `rationale` as for any question.
Players are a game's own (a player is a role in this game, not a thing on
its own), and an actor on the map who is one plays it, linked. A higher
payoff is better for that player; the numbers need only order outcomes
the same way the player would, unless a mixed equilibrium is read from
them.

At most 6 players, 24 strategies each and 1024 outcomes in all.

## Actions

Each is one change set. Agents call them through `act`.

| Action | Takes | Does |
|---|---|---|
| `game.create` | `title`, `note?`, `players?: [{ name, strategies?, actor? }]`, `payoffs?`, `part_of?` | Makes a game, open; links each `actor` given `plays` it. The first player is the matrix's rows, the second its columns |
| `game.player` | `game`, `name`, `strategies?`, `actor?`, `clear?` | Adds a player. Payoffs set already are cleared, so it is refused (`game.shape`) unless `clear: true` |
| `game.strategy` | `game`, `player`, `strategies` | Adds strategies to a player; outcomes they make have no payoff yet |
| `game.payoff` | `game`, `cells: [{ profile, payoff }]` | Sets what outcomes are worth, each replacing the one for its profile. A profile or payoff is a list in player order or an object by player name. Answers how many outcomes are `missing` |
| `game.remove` | `game`, `player`, `strategy?`, `clear?` | Takes a strategy out, with the payoffs that use it; without `strategy`, the player, with its `plays` links (clearing payoffs, so `clear: true`) |
| `game.analyze` | `game`, `record?` | Reasons the game out and answers the analysis. Unless `record: false`, keeps it as a record (`kind: finding`, `value` the analysis, `note` its lines) linked `about` the game, and supersedes the findings it made before. The same analysis again writes nothing. An incomplete game is answered with what is missing, and nothing is kept |

Refusals name what to fix: `game.strategy_unknown` ("Col has no strategy
X. It has: H, T."), `game.player_unknown`, `game.cell`, `game.taken`,
`game.shape`, `game.too_big`, `game.not_a_game`, `game.actor`.

## The analysis

| Part | What |
|---|---|
| `best_responses` | Per player and per choice of the others' (`against`, null at the player's own place), its best strategies |
| `dominated` | Strategies beaten by another of the same player's whatever the others do: `strictly` (worse against everything) or weakly (never better, sometimes worse). Only by a pure strategy |
| `survives` | Each player's strategies left after strictly dominated ones are removed, again and again |
| `nash` | The pure-strategy Nash equilibria: outcomes where no player gains by moving alone. Each says if another outcome is at least as good for all and better for one (`pareto_dominated_by`): a dilemma |
| `pareto` | The outcomes nothing is better than for everyone |
| `mixed` | For two players with two strategies each: the fully mixed equilibrium, each player's chances and what each expects; null when there is none (or a continuum) |
| `summary` | The same in lines, which the finding's note holds |

## The view

**Games** (`game/games`, in `center`): the games on the map, and the one
`here.item` names, else the first, drawn whole. In the matrix a payoff is
underlined where it is that player's best response, so an outcome with
every payoff underlined is an equilibrium, and it is ringed; a strictly
dominated strategy is struck through. Under it, the reasoning in lines and
**Keep this analysis**, which calls `game.analyze` as the person at the
page, and the findings kept. On a game's item page (`item.actions`), the
same matrix small, its equilibria, and the way into Games. More than two
players are drawn one row per outcome.

## In plain words: the explain plugin

[explain.ts](explain.ts), server side, its own entry (`explain`) so games
work on a server with no model. Injects `types.define`, `action.register`,
`graph.read` and `typed.ask`.

| Type | Is | Fields |
|---|---|---|
| `explanation` | a flavour of `record`, on trial, linked `about` what it explains | `version` (the game's players and payoffs, hashed: `versionOf`), `decision` (`accepted`, `rejected`), `decided_version` |

| Action | Takes | Does |
|---|---|---|
| `explain.game` | `game` | Asks the model what the game means for the people in it, through `typed.ask`: one explanation, its `title` the takeaway and its `note` a few paragraphs. Keeps it about the game and supersedes the one before. Refused for an incomplete game (`explain.incomplete`) and with no model (`typed.no_model`) |
| `explain.decide` | `explanation`, `decision` | A person's `accepted` or `rejected`, at the explanation's version |

It is a call ([call](../call/README.md)): a run of its own under "explain
calls", shown in the Context interface. Its voice starts from `SYSTEM` in
explain.ts, and **what the map's nodes say at `game:explain` is added to
it**: write a node there ("write for a shop owner, not an economist") and
the next explanation hears it, with context filters choosing as they do for
agents. The call follows the explanation, so a person's accept or reject is
recorded on its run and judges the nodes said to it, as the learning loop
judges any node. The model sees the game, its players (and the actors who
play them), the outcomes and the analysis's lines; the exchange records the
prompt only by size.

The model is the typed plugin's: `ARCHIPELAGO_MODEL` on the server
(`anthropic:<model>` with `ANTHROPIC_API_KEY` in the environment,
`openai:<model>`, or `claude[:<model>]` for the Claude Code CLI). The
plugin's own config may name a `model` instead, for tests and demos.

In Games, under the analysis: **Explain in plain words** (then **Explain
again**), the explanation kept, accept and reject. One said of an earlier
version of the game is dimmed, with a word to explain it again.

## A worked example: a pricing standoff

Two firms sell the same thing. Each can keep its price high or cut it. If
both stay high each earns 10; if one cuts, it takes the market (12) and the
other is left with 2; if both cut, each earns 5.

```json
act game.create {
  "title": "Pricing standoff",
  "note": "Two firms, one market, one season. Profit in units of 100k.",
  "players": [
    { "name": "North", "strategies": ["High", "Low"] },
    { "name": "South", "strategies": ["High", "Low"] }
  ],
  "payoffs": [
    { "profile": ["High", "High"], "payoff": [10, 10] },
    { "profile": ["High", "Low"],  "payoff": [2, 12] },
    { "profile": ["Low", "High"],  "payoff": [12, 2] },
    { "profile": ["Low", "Low"],   "payoff": [5, 5] }
  ]
}
act game.analyze { "game": "<the id it answered>" }
```

The finding says:

- Pure equilibria: (Low, Low) paying 5, 5.
- North: High is strictly dominated by Low.
- South: High is strictly dominated by Low.
- Removing strictly dominated strategies again and again leaves North Low; South Low.
- (Low, Low) is an equilibrium, yet every player does at least as well at (High, High): a dilemma.
- Mixed: no fully mixed equilibrium (or a continuum of them).

It is the prisoner's dilemma. A next step on the map: a second game where
the season repeats, or a `question` for what would let the firms trust a
high price, with this game `bears_on` it. If a firm's payoff for holding
high against a cut rises above 5 (a loyal customer base, say), cutting is
no longer dominated, and `game.payoff` then `game.analyze` shows the
change; undo takes it back.

## What it does not do yet

- Mixed equilibria beyond 2×2 (support enumeration for two players, or
  more), and dominance by a mixed strategy.
- Games in extensive form (moves in turn, information sets), repeated
  games, and games of incomplete information.
- An explanation in one voice per map: nodes at `game:explain` set it, not
  a choice per reader.
- Editing in the page: a person models a game through the actions, as an
  agent does, and the page shows it.
