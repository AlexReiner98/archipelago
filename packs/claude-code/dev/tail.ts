/**
 * Prints every exchange event as it is appended: a live tail for the host's
 * console. Not part of the adapter; anything that watches the exchange would do.
 */
import type { ExchangeEvent, ExchangeWatch } from "../../../spec/exchange.ts";
import type { Context, Pack } from "../../../runtime/core.ts";

const short = (v: unknown, n = 100) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s === undefined ? "" : s.length > n ? `${s.slice(0, n)}…` : s;
};

export function line(e: ExchangeEvent): string {
  const arrow = e.direction === "to_agent" ? "→ agent" : "← agent";
  const where = e.place ? ` @${e.place}` : "";
  const who = e.node ? ` ${e.node}` : "";
  const what = e.act
    ? ` ${e.act.kind}${e.act.ok === false ? " (not ok)" : ""} ${short(e.act.input ?? e.act.output, 80)}`
    : e.text
      ? ` ${short(e.text)}`
      : "";
  return `${e.run.slice(0, 8)} #${e.seq} ${arrow} ${e.kind}${where}${who}${what}`;
}

const tail: Pack<{ print?: (line: string) => void }> = {
  id: "exchange-tail",
  inject: ["exchange.watch"],
  apply(ctx: Context, config = {}) {
    const print = config.print ?? ((l: string) => console.log(l));
    ctx.get<ExchangeWatch>("exchange.watch").watch({}, (e) => print(line(e)));
  },
};

export default tail;
