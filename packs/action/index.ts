/**
 * The action pack: the one way anyone changes anything. Provides
 * action.register, action.list, action.invoke and action.attest (edition
 * 11: a change on a test's word) (spec/action.md), and is the only pack
 * given graph.commit. An input that doesn't fit its action's schema is
 * refused with how to fix it (input.ts, edition 11).
 *
 * Who is calling is read from the calling context: the actor and run that
 * interception set, else the calling pack itself. Everything an action
 * writes, with the actions it calls, is one change set, committed when the
 * outermost action returns, or nothing at all.
 */
import type { ActionAttest, ActionContext, ActionDef, ActionInfo, ActionInvoke, ActionList, ActionRegister, Outcome } from "../../spec/action.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Actor, Authority, Caller, Dispose, Json, Refusal } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import { UNDO } from "../../spec/action.ts";
import { check, message } from "./input.ts";
import type { GraphCommit, GraphRead } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";

interface Registered {
  def: ActionDef<any, any>;
  pack: string;
}

function refusalOf(err: unknown, action: string): Refusal {
  if (err instanceof Refused) return err.refusal;
  const r = (err as { refusal?: Refusal })?.refusal;
  if (r?.code) return r;
  return { code: "action.failed", message: `${action} failed: ${(err as Error)?.message ?? String(err)}`, by: { pack: "action" } };
}

const action: Pack = {
  id: "action",
  about: "Runs every change to the map, whoever asks for it, as one change that can be undone.",
  inject: ["graph.commit", "graph.read"],
  apply(ctx: Context) {
    const commit = ctx.get<GraphCommit>("graph.commit");
    const graph = ctx.get<GraphRead>("graph.read");
    const actions = new Map<string, Registered>();
    const watchers = new Set<() => void>();
    const changed = () => {
      for (const on of [...watchers]) {
        try {
          on();
        } catch (err) {
          ctx.runtime.report(ctx.fiber, err);
        }
      }
    };

    ctx.provide<ActionRegister>("action.register", (caller, from) => ({
      register(def): Dispose {
        if (!def.name.startsWith(`${caller.pack}.`)) {
          throw new Refused({ code: "action.name_outside", message: `${caller.pack} may only register actions named ${caller.pack}.…, not ${def.name}.`, by: { pack: "action" } });
        }
        if (actions.has(def.name)) {
          throw new Refused({ code: "action.name_taken", message: `An action ${def.name} is already registered.`, by: { pack: "action" } });
        }
        return from.effect(() => {
          actions.set(def.name, { def, pack: caller.pack });
          changed();
          return () => {
            actions.delete(def.name);
            changed();
          };
        });
      },
    }));

    ctx.provide<ActionList>("action.list", (_caller, from) => ({
      list: (): ActionInfo[] =>
        [...actions.values()].map(({ def, pack }) => ({
          name: def.name,
          title: def.title,
          input: def.input,
          pack,
          ...(def.doc ? { doc: def.doc } : {}),
          ...(def.output ? { output: def.output } : {}),
        })),
      watch(on): Dispose {
        return from.effect(() => {
          watchers.add(on);
          return () => watchers.delete(on);
        });
      },
    }));

    /** Runs an action as `caller`, its change set made by `by` (the caller's actor, else the pack itself). */
    const invoke = async <O extends Json = Json>(caller: Caller, call: { action: string; input: Json; authority: Authority; reason: string }, by?: Actor): Promise<Outcome<O>> => {
        const outer = actions.get(call.action);
        if (!outer) {
          return { ok: false, refused: { code: "action.unknown", message: `No action ${call.action} is registered now.`, by: { pack: "action" } } };
        }
        const facts: Fact[] = [];
        /** The set the reserved undo action undid in this call, for the header's `undoes`. */
        let undoes: string | undefined;
        const run = async (name: string, input: Json): Promise<Json> => {
          const r = actions.get(name);
          if (!r) throw new Refused({ code: "action.unknown", message: `No action ${name} is registered now.`, by: { pack: "action" } });
          // An input that doesn't fit the declared schema: what to fix, and the input fixed (edition 11).
          const wrong = check(r.def.input, input);
          if (wrong) throw new Refused({ code: "action.input", message: message(name, wrong), by: { pack: "action" }, detail: wrong as unknown as Json });
          const actx: ActionContext = {
            caller,
            authority: call.authority,
            reason: call.reason,
            write: (f) => void facts.push(...f),
            written: () => facts,
            call: (n, i) => run(n, i) as Promise<any>,
          };
          const out = await r.def.run(input, actx);
          if (name === UNDO && undoes === undefined) undoes = String((input as { change?: Json }).change);
          return out;
        };
        try {
          const output = (await run(call.action, call.input)) as O;
          if (!facts.length) return { ok: true, output };
          const actor: Actor = by ?? caller.actor ?? { id: `pack:${caller.pack}`, kind: "agent" };
          const committed = await commit.commit({
            header: {
              actor,
              authority: call.authority,
              pack: { id: outer.pack },
              action: call.action,
              reason: call.reason,
              time: new Date().toISOString(),
              ...(undoes !== undefined ? { undoes } : {}),
              ...(caller.run ? { run: caller.run } : {}),
            },
            facts,
          });
          return { ok: true, output, change: committed.id, committed };
        } catch (err) {
          return { ok: false, refused: refusalOf(err, call.action) };
        }
    };

    ctx.provide<ActionInvoke>("action.invoke", (caller: Caller) => ({
      invoke: <O extends Json = Json>(call: { action: string; input: Json; authority: ActionContext["authority"]; reason: string }) => invoke<O>(caller, call),
    }));

    // A change on a test's word: the test is the actor, its version the basis (edition 11).
    ctx.provide<ActionAttest>("action.attest", (caller: Caller) => ({
      async invoke<O extends Json = Json>(call: { action: string; input: Json; attest: { test: string; version: string }; reason: string }): Promise<Outcome<O>> {
        const { test, version } = call.attest ?? ({} as { test: string; version: string });
        const bad = (message: string): Outcome<O> => ({ ok: false, refused: { code: "action.attest", message, by: { pack: "action" } } });
        if (typeof test !== "string" || !test || /\s/.test(test)) return bad("An attestation names its test by id.");
        if (typeof version !== "string" || !version || /\s/.test(version)) return bad(`Test ${test}'s attestation needs the version of its inputs, one word.`);
        if (!(await graph.get([test]))[0]) return bad(`Test ${test} isn't on the graph.`);
        const by: Actor = { id: `test:${test}`, kind: "agent" };
        return invoke<O>(caller, { action: call.action, input: call.input, authority: { of: "agent", basis: `test ${test} at ${version}` }, reason: call.reason }, by);
      },
    }));
  },
};

export default action;
