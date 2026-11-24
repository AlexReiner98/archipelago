# sessions

The agent sessions that are live right now, and the context filters each one
is in, kept for the Landscape to draw next to the map's items.

A session is not an item on the map: its facts live on the exchange. This
pack reads the live runs from `exchange.read` and asks `profile.read` which
filters each run is in. A run counts as live while it has not ended and has
not been quiet for more than `QUIET_MIN` minutes, which is 15 minutes, the
same default as the Context interface. The pack keeps the answer in the page
key `sessions.live`, as a list of `{ run, title, filters }`. It writes
nothing to the map.

The pack updates the key when a run begins or ends, when a run changes
filters, and once a minute so that a run which has gone quiet drops out. If
an update gives the same answer, it sets nothing.

The Landscape ([field](../field/README.md)) reads the key by name. It draws
each session as a pentagon of the type `session`, linked `runs_in` to each of
its filters on the map. When the find line finds a filter, it also finds the
sessions in it. The `sessions` dial turns them off.

Tests: [test/sessions.test.ts](../../test/sessions.test.ts).
