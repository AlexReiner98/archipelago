/**
 * The docs pack's tool: agents read the same reference the Packs view
 * draws, as the MCP tool `packs` on the adapter's server (`mcp.host`).
 * A pack of its own beside `docs`, so the reference stands without an MCP
 * server and the tool goes when either does.
 *
 * - No input: each pack in one line, what it provides and its actions.
 * - `pack`: that pack's whole entry.
 */
import type { Context, Pack } from "../../runtime/core.ts";
import { HOST, type McpHost, type ToolResult } from "../mcp/host.ts";
import { KEY, type DocsRead } from "./read.ts";
import type { PackDoc } from "./read.ts";

export const DESCRIPTION =
  "The packs running on the server, read from the packs themselves: what each provides and injects (with the spec contract), its actions and their inputs, " +
  "the kinds of item it defines, the places it speaks at, its config. Give pack for one in full.";

/** One line per pack: its state, what it is for, what it provides, its actions. */
export function brief(docs: PackDoc[]): string {
  return docs
    .map((d) => {
      const parts = [`${d.id} (${d.state})${d.about ? ` ${d.about}` : ""}`];
      if (d.provides.length) parts.push(`provides ${d.provides.map((k) => k.key).join(", ")}`);
      if (d.actions.length) parts.push(`actions ${d.actions.map((a) => a.name).join(", ")}`);
      if (d.places.length) parts.push(`speaks at ${d.places.length} place${d.places.length === 1 ? "" : "s"}`);
      if (d.missing?.length) parts.push(`waits for ${d.missing.join(", ")}`);
      return parts.join("; ");
    })
    .join("\n");
}

const tool: Pack = {
  id: "docs-tool",
  inject: [HOST, KEY],
  apply(ctx: Context) {
    const docs = ctx.get<DocsRead>(KEY);
    ctx.get<McpHost>(HOST).add({
      name: "packs",
      description: () => DESCRIPTION,
      inputSchema: { type: "object", properties: { pack: { type: "string", description: "A pack's id: its whole entry." } } },
      async call(args): Promise<ToolResult> {
        const all = await docs.packs();
        if (typeof args.pack !== "string" || !args.pack) return { text: brief(all) };
        const one = all.find((d) => d.id === args.pack);
        if (!one) return { text: `No pack ${JSON.stringify(args.pack)} is loaded. Loaded: ${all.map((d) => d.id).join(", ")}.`, isError: true };
        return { text: JSON.stringify(one, null, 1) };
      },
    });
  },
};

export default tool;
