/**
 * A few nodes to see the adapter speak, until real node plugins exist. Each
 * says one plain thing at one place, and one refuses, so a session shows
 * both directions.
 */
import type { AgentNode } from "../../../spec/agent.ts";
import type { Context, Plugin } from "../../../runtime/core.ts";

const demo: Plugin = {
  id: "demo-nodes",
  inject: ["agent.node"],
  apply(ctx: Context) {
    const node = ctx.get<AgentNode>("agent.node");
    node.node({
      name: "hello",
      kind: "instruction",
      title: "Says the run is watched",
      at: ["session_start"],
      speak: (_m, run) => ({ say: `This run (${run.run.slice(0, 8)}) is recorded on the exchange: every say, refusal and act.` }),
    });
    node.node({
      name: "file-note",
      kind: "reflex",
      title: "Names the file about to be touched",
      at: ["file:**"],
      speak: (m) => ({ say: `The map saw you reach ${m.places.find((p) => p.startsWith("file:"))}.` }),
    });
    node.node({
      name: "no-secrets",
      kind: "rule",
      title: "Refuses to touch .env files",
      at: ["file:**/.env", "file:.env"],
      speak: () => ({ refuse: "The map refuses .env files: they hold secrets.", code: "demo.secret" }),
    });
    node.node({
      name: "after-bash",
      kind: "reflex",
      title: "Notes a Bash result",
      at: ["tool_result:Bash"],
      speak: () => ({ say: "The map saw that Bash result." }),
    });
  },
};

export default demo;
