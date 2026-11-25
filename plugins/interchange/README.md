# interchange

A graph moved in by the interchange format ([graph/interchange.ts](../graph/interchange.ts),
change sets as JSON Lines) goes down the write chain like any change: the
schema checks it, the journal keeps it, undo takes it back.

| Action | Does |
|---|---|
| `interchange.import` `{ facts }` | Writes one change set's facts (`[op, id, field, value]`) as one change set here, at most 20 000 facts |

The set's own header is not carried: the journal names whoever invoked the
import, on the authority they gave, with their reason. A mover that knows
on whose say-so the facts were first made groups them by it and imports
each group with that authority (`scripts/from-pelago.ts` does).

Injects `action.register`.
