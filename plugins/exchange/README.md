# exchange

Provides `exchange.append`, `exchange.read` and `exchange.watch`
([spec](../../spec/exchange.md)).

- Events are numbered per run as they are appended, and streamed at once
  to every watcher whose filter matches.
- Runs come from their `begin` event, with `ended` from an `end` that
  came after the last `begin` (a run that begins again is open again).
- `runs` is newest first by the run's last event, so a long run that is
  acting now comes before a short one that began later and stopped.
- With `config.journal` set to a file (Node only), every event is appended
  to it as a JSON line and read back on load, so the record outlives a
  restart. Without it, the record is in memory.
- `exchange.append` should be given only to the agent plugin. Nothing here
  enforces it; narrowing it is the config tree's job.
