# Benchmarks

Two scripts time the map as people and agents use it, through the server's own `/agent` tools. `scripts/bench-views.ts` times the heavy views and a typical change against any running server. `scripts/bench-scale.ts` (`npm run bench:scale`) builds a year-three map of ten million events, opens a throwaway server on it, runs `bench-views.ts` against it as it is, and times what that does not: writes, approval, undo, the log, backup, restore and the size on disk. Neither is part of `npm test`.

## The views, against any server

```bash
node scripts/bench-views.ts http://127.0.0.1:3100 20
```

Only ever against a scratch map: the dev server's pulled copy, or a throwaway server with its own data folder. `--seed 20000` fills an empty throwaway server with that many projects and tasks first. The header of the script says what it picks and why.

## At year-three size

```bash
npm run bench:scale
npm run bench:scale -- --db postgres --events 10000000 --runs 5
npm run bench:scale -- --events 200000 --runs 3
```

The last is a quick try of the whole path (under three minutes). At ten million events the bench takes about 40 minutes on either database, a sixth of it the backup, and generating the map the first time 10 to 13 minutes more; the map is kept and reused. It needs about 6 GB of disk for each map, and the backup step up to 8 GB of memory.

- **PGlite:** the map goes under `PELAGO_BENCH_DIR` (the temp folder unless set), in `pglite-<events>-<seed>/`, with the server's log and each run's results as JSON.
- **Postgres:** `PELAGO_BENCH_DATABASE_URL` names a server the bench may make and drop databases on. A container is enough:

  ```bash
  docker run -d --name pelago-bench-pg -p 127.0.0.1:5434:5432 -e POSTGRES_PASSWORD=bench postgres:18 -c shared_buffers=1GB -c max_wal_size=8GB
  ```

  then `PELAGO_BENCH_DATABASE_URL=postgres://postgres:bench@127.0.0.1:5434/postgres`. The map is the database `pelago_scale_<events>_<seed>`.
- A view slower than 30 seconds is timed once rather than eight times (`SLOW`, in ms, which `bench-views.ts` also takes); a pack's view is stopped by the server at 30 seconds and shows as failed.
- `--fresh` generates the map again; `--seed` picks another one of the same shape. The server runs on `PELAGO_BENCH_PORT` (3199), in dev mode, with no backup at start (a placeholder keeps it off; the backup is timed apart, with the server stopped).

## The map

`scripts/gen-map.ts` writes it, from a seed: the same seed and size give the same ids, titles, links and log, ending at the hour it is run. A team of ten people with agents over three years (1,095 days, busier on weekdays and growing through the years), at ten million events:

- **Facts about the work, about a fifth of the log:** some 500,000 items made in change sets by people and agents (tasks, notes, sources, pull requests, decisions, documents, issues, bugs, features, ideas, meetings, a few hundred projects and a release every few weeks), each with a life of status changes and notes added over the following days; part_of trees (projects in projects, tasks in projects and in tasks), depends_on chains, waits_on people, about and relates_to links, some unlinked later; a few archived and merged; held proposals, most approved.
- **Operational, the rest:** agent runs (about 300 a day, each with its story, its works_on and lives_in links, sometimes a claim of a resource and a release), notifications (about 550 a day, most read within a day or two), pushes heard from GitHub, readings of 300 components by a monitor, and tool calls imported from twelve connections.

It is written in bulk, not through `change`: the write path stamps every row with the time it is written, so the map would sit on one day, and it is slow for this (an empty PGlite map takes about 55 items a second through it, 10,000 projects and tasks in three minutes, and it slows as the map grows), so ten million events would take more than a day. In bulk it takes 10 to 13 minutes. The rows are the ones the write path writes (the same columns and kinds, the same event actions and detail), so the server opens the map as its own; every write the bench times then goes through the real path on top of it.

## What it times

`bench-views.ts` unchanged (attention, lens, handoff, brief, hubs, graph, tree, gate, get, search and a typical change), then:

- a change set of eight ops (three items, four links, a note added), and its undo;
- approving a held change of the same eight ops;
- `changed_since` over the last day and the last month, and the newest page of `events`;
- how long the server takes to open the map;
- with the server stopped: the size on disk (the database and each table, and the PGlite folder), a backup as the server takes one (`dump`, then one gzipped JSON file), and restoring it into a new database.

## How often

Before merging any change to the log, the schema, the write path or a heavy view, and once a week while the Rework is under way, on both databases, with the results recorded on the scale benchmark's task on the map. The numbers taken on 24 Oct 2026, before the log became the source of truth, are the baseline there.

## When the log lands

The bench reads and writes only through `/agent` tools, so it runs against the log as it is. The generator is the one part that knows the tables: it writes rows of `entity`, `relation`, `event` and `proposal` in `flush`. When the log is the truth, that becomes appending the same change sets in the log's format and letting the projections be rebuilt from it, which is itself worth timing.
