/**
 * The connect plugin, page side: the first moments of a new map.
 *
 * - While the map has no run, on a server that takes a token or serves its
 *   hook script (a hosted map), the next step: connect Claude Code. It fills
 *   Field's `field.empty` with the MCP line and the hooks for this server
 *   (`connect.setup`), each one line and copied whole with a click. A local
 *   map shows its canvas alone: its README has the command. Where the
 *   server takes a token, "Make a token" asks for one (`connect.token`) and
 *   puts it in what is copied; the line on the page keeps it hidden.
 * - When the first run begins, a line in `over` says so, live, with the
 *   run's name: a click opens it in the harness view.
 * - On a guest map (the server's setup names `save`), a quiet "save" in
 *   `top` leads to where the guest signs up to keep it, and with `signin`
 *   a quiet "sign in" beside it, for someone who has an account.
 *
 * Injects action.invoke, exchange.read, exchange.watch, here.set,
 * slot.fill. Nothing here writes to the map.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import { runName, type RunInfo } from "../../spec/agent.ts";
import type { ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";
import { EVENTS, TOKEN, withToken, type Setup } from "./setup.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const SETUP = "connect.setup";
const MAKE_TOKEN = "connect.token";
/** Where a run opens: the harness view. */
const HARNESS = "harness/view";

const STYLE = sheet(`
.cn { width:min(560px, calc(100vw - 2 * var(--space-5))); display:flex; flex-direction:column; gap:var(--space-2); pointer-events:auto; text-align:left; }
.cn-head { display:flex; gap:var(--space-4); align-items:baseline; white-space:nowrap; color:var(--fg); }
.cn-head .t { font-weight:var(--bold); flex:1; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.cn-row { display:flex; gap:var(--space-4); align-items:baseline; white-space:nowrap; min-width:0; }
.cn-row .k { flex:none; width:3.5em; color:var(--dim); }
.cn-row .v { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; font-family:var(--mono); font-size:var(--text-m); color:var(--fg); }
.cn-row .v.off { color:var(--dim); }
.cn-copy { flex:none; font:inherit; font-size:var(--text-s); background:none; border:0; padding:0; color:var(--pick); cursor:pointer; }
.cn-copy:disabled { color:var(--dim); cursor:default; }
.cn-copy.done { color:var(--held); }
.cn-btn { flex:none; font:inherit; font-size:var(--text-s); background:var(--control); border:1px solid var(--control-line); color:var(--control-fg); border-radius:var(--radius); padding:0 var(--space-3); cursor:pointer; }
.cn-wait { display:flex; gap:var(--space-4); align-items:baseline; color:var(--dim); white-space:nowrap; padding-top:var(--space-3); }
.cn-wait .k { width:3.5em; flex:none; }
.cn-mark::before { content:var(--glyph-circle-fresh); color:var(--mark-fresh); }
.cn-err { color:var(--failed); font-size:var(--text-s); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cn-landed { position:fixed; left:50%; bottom:calc(var(--space-5) * 3); transform:translateX(-50%); max-width:calc(100vw - 2 * var(--space-5)); display:flex; gap:var(--space-4); align-items:baseline; white-space:nowrap;
  background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:var(--space-3) var(--space-4); box-shadow:0 2px 8px rgb(0 0 0 / 12%); }
.cn-landed .x { overflow:hidden; text-overflow:ellipsis; min-width:0; font-weight:var(--bold); }
.cn-save { color:var(--dim); text-decoration:none; font-size:var(--text-s); }
.cn-save + .cn-save { margin-left:var(--space-3); }
.cn-save:hover { color:var(--pick); }
.cn-landed .f { flex:none; color:var(--dim); }
.cn-landed .m::before { content:var(--glyph-circle-moving); color:var(--mark-moving); }
.cn-landed .go { flex:none; color:var(--pick); cursor:pointer; }
.cn-landed .no { flex:none; color:var(--dim); cursor:pointer; }
`);

/** A run's name: its title, else its folder, else the start of its id. */
export { runName };

/** A text with the token hidden, for the line on the page. */
const hidden = (text: string, token: string | undefined) => text.replaceAll(TOKEN, token ? "••••••" : TOKEN);

const connectView: Plugin = {
  id: "connect",
  about: "The first moments of a new map: connect Claude Code, then see the first run land.",
  inject: ["action.invoke", "exchange.read", "exchange.watch", "here.set", "slot.fill"],
  apply(ctx: Context) {
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const exchange = ctx.get<ExchangeRead>("exchange.read");
    const live = ctx.get<ExchangeWatch>("exchange.watch");
    const set = ctx.get<HereSet>("here.set");

    /**
     * Whether the map has a run (undefined while reading), and the first run
     * that began while this page looked at a map with none: shared by both fills.
     */
    let had: boolean | undefined;
    let landed: RunInfo | undefined;
    /** What this server says to copy, and where a guest saves the map: read once. */
    let made: Setup | undefined;
    let failed: string | undefined;
    const subs = new Set<() => void>();
    const tell = () => subs.forEach((f) => f());
    exchange.runs({ limit: 1 }).then(
      (p) => ((had = p.items.length > 0), tell()),
      () => ((had = false), tell()),
    );
    invoke.invoke({ action: SETUP, input: {}, authority: { of: "human", basis: "opened the map" }, reason: "Show how to connect Claude Code" }).then(
      (o) => (o.ok ? (made = o.output as unknown as Setup) : (failed = o.refused.message), tell()),
      (e) => ((failed = String(e?.message ?? e)), tell()),
    );
    ctx.effect(() =>
      live.watch({ kinds: ["begin"] }, async (e) => {
        if (had) return;
        had = true;
        const p = await exchange.runs({ limit: 5 }).catch(() => undefined);
        landed = p?.items.find((r) => r.run === e.run) ?? { run: e.run, started: e.time } as RunInfo;
        tell();
      }),
    );
    const useFirst = () => {
      const [, tick] = useState(0);
      useEffect(() => {
        const f = () => tick((x) => x + 1);
        subs.add(f);
        return () => void subs.delete(f);
      }, []);
      return { had, landed, made, failed };
    };

    const Copy = ({ text, off }: { text: string; off?: boolean }) => {
      const [done, setDone] = useState(false);
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // No clipboard here (not a secure page): the whole text is in the line's tooltip.
        }
      };
      return html`<button class=${`cn-copy${done ? " done" : ""}`} disabled=${off} onClick=${copy} title=${off ? "Make a token first" : "Copy it whole"}>${done ? "copied" : "copy"}</button>`;
    };

    /** The next step on a map with no run: the MCP line, the hooks, and the wait for the first run. */
    const Connect = () => {
      const { had, made: setup, failed } = useFirst();
      const [token, setToken] = useState<string | undefined>(undefined);
      const [tokenErr, setErr] = useState<string | undefined>(undefined);
      const err = tokenErr ?? failed;
      // Only where the page holds what the terminal can't: a token, or a hosted hook script. A local map is its canvas alone (README, "Connect Claude Code").
      if (had !== false || !setup || !(setup.token || setup.install)) return null;
      const make = async () => {
        if (setup?.tokenAt) {
          // The host keeps tokens: ask it, on this origin, with this page's cookie.
          try {
            const r = await fetch(setup.tokenAt, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "claude-code" }) });
            const out = (await r.json().catch(() => ({}))) as { token?: unknown; error?: unknown };
            if (r.ok && typeof out.token === "string") setToken(out.token);
            else setErr(typeof out.error === "string" ? out.error : `No token came back (${r.status}).`);
          } catch (e) {
            setErr(String((e as Error)?.message ?? e));
          }
          return;
        }
        const o = await invoke.invoke<{ token: string }>({ action: MAKE_TOKEN, input: { name: "claude-code" }, authority: { of: "human", basis: "asked for a token on the page" }, reason: "A token for Claude Code" });
        if (o.ok && typeof o.output?.token === "string") setToken(o.output.token);
        else setErr(o.ok ? "No token came back." : o.refused.message);
      };
      const needs = !!setup?.token && !token;
      const mcp = setup ? withToken(setup.mcp, token) : "";
      const hooks = setup ? withToken(setup.install ?? setup.hooks, token) : "";
      return html`<div class="cn">
        <div class="cn-head">
          <span class="t" title="Each Claude Code session then reports here: the hooks record every run, and the MCP server lets the agent read and change the map.">Connect Claude Code</span>
          ${needs && html`<button class="cn-btn" onClick=${make} title="A token for your Claude Code, shown to you only, once. It goes into both lines below.">Make a token</button>`}
        </div>
        ${setup && html`
          <div class="cn-row" title=${`Run in a terminal:\n${hidden(setup.mcp, token)}`}>
            <span class="k">MCP</span><span class=${`v${needs ? " off" : ""}`}>${hidden(setup.mcp, token)}</span><${Copy} text=${mcp} off=${needs} />
          </div>
          ${setup.install
            ? html`<div class="cn-row" title=${`Run in a terminal: it saves the hook script to ~/.archipelago/hook.ts and adds ${EVENTS.length} hooks to ~/.claude/settings.json, keeping the rest. Every event goes to\n${setup.hookUrl}`}>
                <span class="k">Hooks</span><span class=${`v${needs ? " off" : ""}`}>node -e … · ${EVENTS.length} hooks into ~/.claude/settings.json</span><${Copy} text=${hooks} off=${needs} />
              </div>`
            : html`<div class="cn-row" title=${`Merge into ~/.claude/settings.json: every event goes to\n${setup.hookUrl}`}>
                <span class="k">Hooks</span><span class=${`v${needs ? " off" : ""}`}>~/.claude/settings.json · ${EVENTS.length} hooks</span><${Copy} text=${hooks} off=${needs} />
              </div>`}`}
        ${err && html`<div class="cn-err" title=${err}>${err}</div>`}
        <div class="cn-wait" title="Start Claude Code in any repository: its run shows here as it begins."><span class="k cn-mark"></span><span>Waiting for the first run</span></div>
      </div>`;
    };

    /** The first run, as it lands: a click opens it. */
    const Landed = () => {
      const { landed } = useFirst();
      const [gone, setGone] = useState(false);
      if (!landed || gone) return null;
      const open = () => {
        set.set(KEYS.view, HARNESS);
        set.set(KEYS.run, landed.run);
        setGone(true);
      };
      return html`<div class="cn-landed">
        <span class="m"></span><span class="f">First run</span><span class="x" title=${`The first run on this map: ${runName(landed)}`}>${runName(landed)}</span>
        <span class="go" onClick=${open} title="Open it in the harness view">open</span>
        <span class="no" onClick=${() => setGone(true)} title="Close">×</span>
      </div>`;
    };

    /** On a guest map (the server names `save` or `signin`): a quiet way to keep it (sign-up), and one to sign in instead. */
    const Save = () => {
      const { made } = useFirst();
      if (!made?.save && !made?.signin) return null;
      return html`${made.signin && html`<a class="cn-save" href=${made.signin} title="Have an account? Sign in to it">sign in</a>`}${made.save && html`<a class="cn-save" href=${made.save} title="This map is a guest's: sign up to keep it">save</a>`}`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    const fill = ctx.get<SlotFill>("slot.fill");
    fill.fill({ slot: "field.empty", name: "connect", view: Connect });
    fill.fill({ slot: "over", name: "landed", view: Landed });
    fill.fill({ slot: "top", name: "save", view: Save });
  },
};

export default connectView;
