/**
 * The interchange format: a graph written as change sets (spec/changeset.ts),
 * one per line (JSON Lines). Exporting writes what the graph holds now as
 * `+` facts, a bounded batch of items to a set; importing applies each set
 * whole, as any commit is applied. A graph moves between stores, or from
 * another system, by this and nothing else.
 *
 * These work on a store directly, for when no runtime holds it (a move,
 * a backup). While a runtime runs, a set is imported by committing it.
 */
import type { Header, Proposed } from "../../spec/changeset.ts";
import type { Id } from "../../spec/common.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import { withHeaderNow } from "./renamed.ts";
import { type Fields, type Store, factsOf } from "./store.ts";

/** The change sets that make `items`, at most `batch` items to a set. */
export function* setsOf(items: Iterable<[Id, Fields]>, header: Header, batch = LIMIT_MAX): Generator<Proposed> {
  let facts: Proposed["facts"] = [];
  let n = 0;
  for (const [id, fields] of items) {
    facts.push(...factsOf(id, fields));
    if (++n === batch) {
      yield { header, facts };
      facts = [];
      n = 0;
    }
  }
  if (facts.length) yield { header, facts };
}

/** What `store` holds now, as change sets, read a page at a time. */
export function* exportSets(store: Store, header: Header, batch = LIMIT_MAX): Generator<Proposed> {
  function* items(): Generator<[Id, Fields]> {
    let after: string | undefined;
    do {
      const page = store.all({ limit: LIMIT_MAX, after });
      for (const item of page.items) yield [item.id, { type: item.type, ...item.fields }];
      after = page.next;
    } while (after);
  }
  yield* setsOf(items(), header, batch);
}

/** Applies each set to `store` in order; each is all or nothing. Returns how many facts went in. */
export function importSets(store: Store, sets: Iterable<Proposed>): { sets: number; facts: number } {
  let n = 0;
  let facts = 0;
  for (const set of sets) {
    store.apply(set);
    n++;
    facts += set.facts.length;
  }
  return { sets: n, facts };
}

/** Change sets as JSON Lines, and back. */
export const toLines = (sets: Iterable<Proposed>): string => [...sets].map((s) => JSON.stringify(s)).join("\n") + "\n";
export function* fromLines(text: string): Generator<Proposed> {
  for (const line of text.split(/\r?\n/)) if (line.trim()) yield withHeaderNow(JSON.parse(line) as Proposed);
}
