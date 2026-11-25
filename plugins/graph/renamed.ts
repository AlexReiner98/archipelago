/**
 * What was written before spec edition 11, read as it is named now. Edition
 * 11 renamed the word `pack` to `plugin` (RENAMED in spec/common.ts), and
 * what the graph, the history and the exchange already hold on disk keeps
 * the old word: it is never rewritten, only read renamed, here. The old
 * word stays in this file on purpose.
 */
import type { Header } from "../../spec/changeset.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import type { Json } from "../../spec/common.ts";

/** The old name of a field that now reads `plugin`. */
const OLD = "pack";

/** An object with its old `pack` field read as `plugin`; one that has `plugin` already is as it is. */
function moved<T extends object>(o: T): T {
  const r = o as Record<string, unknown>;
  if (!(OLD in r) || "plugin" in r) return o;
  const { [OLD]: plugin, ...rest } = r;
  return { ...rest, plugin } as T;
}

/** A change set (or anything with a header) written before edition 11, its header's `pack` read as `plugin`. */
export function withHeaderNow<T extends { header: Header }>(set: T): T {
  const header = moved(set.header);
  return header === set.header ? set : { ...set, header };
}

/** A header written before edition 11. */
export const headerNow = (h: Header): Header => moved(h);

/** An exchange event written before edition 11, its `pack` read as `plugin`. */
export const eventNow = (e: ExchangeEvent): ExchangeEvent => moved(e);

/**
 * An actor id a plugin acted as: `plugin:<id>` now, `pack:<id>` in what
 * was written before edition 11. The plugin's id, or undefined for anyone
 * else.
 */
export function actingPlugin(actor: string | undefined): string | undefined {
  const m = /^(?:plugin|pack):(.+)$/.exec(actor ?? "");
  return m?.[1];
}

/** An item's field that edition 11 renamed: `plugins`, else its old name `packs`. */
export const fieldNow = (fields: Record<string, Json> | undefined, name: "plugins"): Json | undefined =>
  fields?.[name] ?? fields?.[name.replace(/^plugin/, OLD)];

/** The field's old name, still on an item written before edition 11 (`packs`), when it is there. */
export const oldField = (fields: Record<string, Json> | undefined, name: "plugins"): [string, Json] | undefined => {
  const old = name.replace(/^plugin/, OLD);
  return fields && fields[old] !== undefined ? [old, fields[old]!] : undefined;
};
