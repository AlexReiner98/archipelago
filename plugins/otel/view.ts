/**
 * The otel plugin, page side: on the run the harness shows, whether it was
 * exported as OpenTelemetry spans, and where. Fills the harness's
 * `harness.run` slot (the line under the run's head) with a mark:
 *
 * - `⇢ otel · <host>`: the collector took spans for this run (how many,
 *   when, whether the run's own span went yet, in its title).
 * - `⇢ otel · failed`: the last send failed (its error in the title).
 * - `⇢ otel · waiting`: export is on, nothing taken for this run yet.
 * - Nothing when the server's otel plugin is off or not loaded.
 *
 * Asks `otel.status` for the one run, again every POLL_MS while it shows.
 * Injects action.invoke and slot.fill. Writes nothing.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { RunInfo } from "../../spec/agent.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";
import type { RunStatus } from "./index.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const STATUS = "otel.status";
/** The harness's slot on a run's line. */
export const RUN_SLOT = "harness.run";
export const POLL_MS = 5000;

/** What `otel.status` answers. */
export interface Status {
  on: boolean;
  endpoint?: string;
  include_content: boolean;
  runs: RunStatus[];
}

/** The mark's words and title for one run's status, or nothing to show. */
export function markOf(s: Status | undefined, run: string): { text: string; title: string; failed: boolean } | undefined {
  if (!s?.on || !s.endpoint) return undefined;
  const r = s.runs.find((x) => x.run === run);
  const host = new URL(s.endpoint).host;
  const words = s.include_content ? "with the words" : "without the map's words";
  if (r?.error) return { text: "otel · failed", title: `Sending spans to ${s.endpoint} failed: ${r.error}${r.spans ? `\n${r.spans} spans taken before` : ""}${r.failed ? `\n${r.failed} dropped` : ""}`, failed: true };
  if (!r?.spans) return { text: "otel · waiting", title: `Exported as OpenTelemetry spans to ${s.endpoint}, ${words}: nothing taken for this run yet`, failed: false };
  return {
    text: `otel · ${host}`,
    title: `Exported as OpenTelemetry spans to ${s.endpoint}, ${words}\n${r.spans} spans taken, last ${r.sent ?? ""}\n${r.whole ? "The run's own span went with them" : "The run's own span goes when it ends"}${r.failed ? `\n${r.failed} dropped` : ""}`,
    failed: false,
  };
}

const STYLE = sheet(`
.ot-mark { color:var(--dim); flex:none; }
.ot-mark::before { content:"⇢ "; }
.ot-mark.failed { color:var(--failed); }
`);

const otelView: Plugin = {
  id: "otel",
  about: "Shows on a run whether it was exported as OpenTelemetry spans, and where.",
  inject: ["action.invoke", "slot.fill"],
  apply(ctx: Context) {
    const invoke = ctx.get<ActionInvoke>("action.invoke");

    const Mark = ({ run }: { run?: RunInfo }) => {
      const [status, setStatus] = useState<Status | undefined>();
      useEffect(() => {
        if (!run) return;
        let live = true;
        const ask = async () => {
          const out = await invoke.invoke({ action: STATUS, input: { runs: [run.run] }, authority: { of: "human", basis: "the run pane shows its export" }, reason: "show export" }).catch(() => undefined);
          if (live) setStatus(out?.ok ? (out.output as unknown as Status) : undefined);
        };
        void ask();
        const t = setInterval(() => void ask(), POLL_MS);
        return () => {
          live = false;
          clearInterval(t);
        };
      }, [run?.run]);
      const m = run ? markOf(status, run.run) : undefined;
      return m ? html`<span class=${`ot-mark${m.failed ? " failed" : ""}`} title=${m.title}>${m.text}</span>` : null;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: RUN_SLOT, name: "export", view: Mark });
  },
};

export default otelView;
