/**
 * The docs plugin's tool: agents read the same reference the Plugins view
 * draws, as the MCP tool `plugins` on the adapter's server (`mcp.host`).
 * A plugin of its own beside `docs`, so the reference stands without an MCP
 * server and the tool goes when either does.
 *
 * - No input: each plugin in one line, what it provides and its actions.
 * - `plugin`: that plugin's whole entry.
 */
import type { Context, Plugin } from "../../runtime/core.ts";
import { HOST, type McpHost, type ToolResult } from "../mcp/host.ts";
import { KEY, type DocsRead } from "./read.ts";
import type { PluginDoc } from "./read.ts";

export const DESCRIPTION =
  "The plugins running on the server, read from the plugins themselves: what each provides and injects (with the spec contract), its actions and their inputs, " +
  "the kinds of item it defines, the places it speaks at, its config. Give plugin for one in full.";

/** One line per plugin: its state, what it is for, what it provides, its actions. */
export function brief(docs: PluginDoc[]): string {
  return docs
    .map((d) => {
      const parts = [`${d.id} (${d.state})${d.about ? ` ${d.about}` : ""}`];
      if (d.provides.length) parts.push(`provides ${d.provides.map((k) => k.key).join(", ")}`);
      if (d.actions.length) parts.push(`actions ${d.actions.map((a) => a.name).join(", ")}`);
      if (d.places.length) parts.push(`speaks at ${d.places.length} place${d.places.length === 1 ? "" : "s"}`);
      if (d.missing?.length) parts.push(`waits for ${d.missing.join(", ")}`);
      if (d.error) parts.push(`failed: ${d.error}${d.where?.file ?? d.where?.module ? ` (at ${d.where.file ?? d.where.module})` : ""}`);
      return parts.join("; ");
    })
    .join("\n");
}

const tool: Plugin = {
  id: "docs-tool",
  about: "Lets agents read what every running plugin is for and what it adds.",
  inject: [HOST, KEY],
  apply(ctx: Context) {
    const docs = ctx.get<DocsRead>(KEY);
    ctx.get<McpHost>(HOST).add({
      name: "plugins",
      description: () => DESCRIPTION,
      inputSchema: { type: "object", properties: { plugin: { type: "string", description: "A plugin's id: its whole entry." } } },
      async call(args): Promise<ToolResult> {
        const all = await docs.plugins();
        if (typeof args.plugin !== "string" || !args.plugin) return { text: brief(all) };
        const one = all.find((d) => d.id === args.plugin);
        if (!one) return { text: `No plugin ${JSON.stringify(args.plugin)} is loaded. Loaded: ${all.map((d) => d.id).join(", ")}.`, isError: true };
        return { text: JSON.stringify(one, null, 1) };
      },
    });
  },
};

export default tool;
