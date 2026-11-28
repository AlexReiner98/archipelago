# record

One of the map's bases or its links: see [work](../work/README.md).

## When it was so

`as_of` and `valid_to` are dates (ISO 8601) in world time: when the record
was so, not when the map learned it. `as_of` is when it became so;
`valid_to`, the first day it no longer is (absent, it still is). When the
map learned it is the log's: `history.at` and `history.diff`.

Keep `valid_to` and `superseded` apart. A record of a past job is still
`current`, with a `valid_to`: it was so, and the map stands by it.
`superseded` says the map stopped standing by it (a correction).

Both are facts in change sets like any other field, so `history.at` over
them answers "what did the map hold on one date about another". The find
line's `as_of:<date>` keeps the records true on a date
([find](../find/README.md)).
