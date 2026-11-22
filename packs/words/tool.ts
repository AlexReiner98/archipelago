/**
 * The words tool: an agent asks for a node's whole words, as the MCP tool
 * `words` on the adapter's server (`mcp.host`). A listed node's line at
 * `session_start` names it. A pack of its own beside `words`, so the words
 * stand without an MCP server and the tool goes when either does.
 *
 * - `node`: that node's whole words (its item id, or its title). The run is
 *   told the words pack it heard them, so a later change is told as such.
 * - No input: each listed node in one line.
 */
import type { Id } from "../../spec/common.ts";
import type { GraphRead, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { HOST, type McpHost, type ToolResult } from "../mcp/host.ts";
import { HEARD, listing, sayHow, TOOL, wholeWords, type WordsHeard } from "./heard.ts";
import { TRIAL_MARK, TYPE } from "./index.ts";

export const DESCRIPTION =
  "A map node's whole words. Nodes listed at session start say one line there; give node (its id from that line, or its title) for its words in full. No input: the listed nodes, one line each.";

const standing = (i: Item) => i.type === TYPE && i.fields.status !== "retired" && !i.fields.voice;

const tool: Pack = {
  id: "words-tool",
  about: "Lets agents ask for a map node's whole words, when only its line was said.",
  inject: [HOST, HEARD, "graph.read"],
  apply(ctx: Context) {
    const graph = ctx.get<GraphRead>("graph.read");
    const heard = ctx.get<WordsHeard>(HEARD);
    /** Every node item, a page at a time, until `stop` says enough. */
    const scan = async (stop: (i: Item) => boolean) => {
      const out: Item[] = [];
      for (let p = await graph.of(TYPE, { limit: LIMIT_MAX }); ; p = await graph.of(TYPE, { limit: LIMIT_MAX, after: p.next })) {
        for (const i of p.items) {
          if (!standing(i)) continue;
          out.push(i);
          if (stop(i)) return out;
        }
        if (!p.next) return out;
      }
    };
    ctx.get<McpHost>(HOST).add({
      name: TOOL,
      description: () => DESCRIPTION,
      inputSchema: { type: "object", properties: { node: { type: "string", description: "A node's item id, or its title." } } },
      async call(args, run): Promise<ToolResult> {
        const want = typeof args.node === "string" ? args.node.trim().replace(/^words\//, "") : "";
        if (!want) {
          const listed = (await scan(() => false)).filter((i) => sayHow(i) === "listed");
          return { text: listed.length ? listed.map(listing).join("\n") : "No node is listed: every node says its whole words." };
        }
        let [item] = (await graph.get([want as Id])) as (Item | null)[];
        if (!item || !standing(item)) {
          const low = want.toLowerCase();
          item = (await scan((i) => String(i.fields.title ?? "").toLowerCase() === low)).find((i) => String(i.fields.title ?? "").toLowerCase() === low) ?? null;
        }
        if (!item) return { text: `No node ${JSON.stringify(want)} on the map (or it was retired).`, isError: true };
        const text = wholeWords(item, TRIAL_MARK);
        if (!text) return { text: `${String(item.fields.title ?? item.id)} has no words.`, isError: true };
        if (run) await heard.heard(run.run, item.id);
        return { text: `${String(item.fields.title ?? item.id)}\n\n${text}` };
      },
    });
  },
};

export default tool;
