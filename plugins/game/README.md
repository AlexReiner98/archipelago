# game

A situation modelled on the map as a game, so people and agents can reason
it out together: who the players are, what each can do, what each outcome
is worth to each, and what follows from that. The reasoning is kept on the
map as a finding about the game, and like every change it can be undone.

| File | Runs | What it is |
|---|---|---|
| [analysis.ts](analysis.ts) | both | The reasoning, pure: a game in, an analysis out |
| [index.ts](index.ts) | server | The `game` flavour, the `plays` link and the actions. Injects `types.define`, `action.register`, `graph.read` |
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
- Editing in the page: a person models a game through the actions, as an
  agent does, and the page shows it.
