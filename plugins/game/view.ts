/**
 * The game plugin, page side: a game's payoff matrix with what follows
 * from it marked.
 *
 * - In `center`, the view "Games" (`game/games`): the games on the map,
 *   and the one `here.item` names (else the first) drawn whole: the
 *   matrix, its equilibria and dominated strategies, the mixed
 *   equilibrium of a 2×2 game, and the reasoning in lines.
 * - On a game's item page (`item.actions`): the matrix, small, and the
 *   way into Games.
 *
 * In the matrix a payoff is underlined where it is that player's best
 * response, an outcome every player best-responds in is an equilibrium
 * (ringed), and a strictly dominated strategy is struck through. It reads
 * through find's index, reasons with analysis.ts as `game.analyze` does,
 * and writes only through actions: `game.create` (a new game, from its
 * title, in the list), `game.payoff`, `game.strategy`, `game.player` and
 * `game.remove` and `game.rename` (while editing: a cell takes its
 * payoffs, players and strategies are renamed, added and taken out), `game.analyze` ("Keep this analysis"),
 * and the explain plugin's `explain.game` and `explain.decide` (the game
 * in plain words, from the configured model, with accept and reject).
 */
import { h } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { Json } from "../../spec/common.ts";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { FindIndex } from "../find/index.ts";
import type { Row } from "../find/query.ts";
import { analyze, readGame, versionOf, type Analysis, type Game } from "./analysis.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const VIEW = "game/games";
const TYPE = "game";
const LIMIT = 200;
/** The explain plugin's flavour (explain.ts), named here so the page needs none of its server code. */
const EXPLANATION = "explanation";
/** What typed.models answers. */
interface Models {
  default: string | null;
  choices: { spec: string; key?: string; ready: boolean }[];
}
/** The page key the sessions plugin keeps the live agent sessions in (plugins/sessions). */
const SESSIONS = "sessions.live";
interface LiveSession {
  run: string;
  title: string;
}
/** The model last picked on this page, kept across games while the page is open. */
let chosenModel = "";
/** The game being edited on this page, so a game just made opens in edit. */
let editing = "";

const STYLE = sheet(`
.gm { padding:var(--space-3) var(--space-4); overflow:auto; height:100%; box-sizing:border-box; font-size:var(--text-s); display:flex; gap:var(--space-4); }
.gm-list { flex:0 0 14rem; border-right:1px solid var(--line); padding-right:var(--space-3); }
.gm-list div { padding:2px 0; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gm-list div:hover { color:var(--pick); }
.gm-list .on { color:var(--pick); font-weight:var(--bold); }
.gm-main { flex:1; min-width:0; overflow-x:auto; }
@media (max-width:40rem) {
  .gm { flex-direction:column; gap:var(--space-2); }
  .gm-list { flex:none; border-right:0; border-bottom:1px solid var(--line); padding:0 0 var(--space-2); }
}
.gm-main h2 { font-size:var(--text-l); margin:0 0 var(--space-1); cursor:pointer; }
.gm-main h2:hover { color:var(--pick); }
.gm-dim { color:var(--dim); }
.gm-note { color:var(--dim); margin:0 0 var(--space-3); white-space:pre-wrap; }
.gm-mx { border-collapse:collapse; margin:var(--space-2) 0 var(--space-3); }
.gm-mx th, .gm-mx td { border:1px solid var(--line); padding:var(--space-1) var(--space-3); text-align:center; white-space:nowrap; }
.gm-mx th { font-weight:normal; color:var(--dim); }
.gm-mx th.p { color:var(--fg); font-weight:var(--bold); }
.gm-mx td.ne { outline:2px solid var(--pick); outline-offset:-3px; }
.gm-mx td.miss { color:var(--dim); }
.gm-mx .br { text-decoration:underline; font-weight:var(--bold); }
.gm-mx .dom { text-decoration:line-through; color:var(--dim); }
.gm-sum { margin:0 0 var(--space-3); padding-left:1.2em; }
.gm-sum li { margin:2px 0; }
.gm-bar { display:flex; gap:var(--space-2); align-items:baseline; flex-wrap:wrap; }
.gm-btn { font:inherit; background:var(--control); border:1px solid var(--control-line); color:var(--control-fg); border-radius:var(--radius); padding:0 var(--space-3); cursor:pointer; }
.gm-btn:hover { border-color:var(--dim); }
.gm-err { color:var(--failed); }
.gm-key { color:var(--dim); font-size:var(--text-xs); }
.gm-small { font-size:var(--text-xs); }
.gm-small .gm-mx { margin:var(--space-1) 0; }
.gm-small .gm-mx th, .gm-small .gm-mx td { padding:1px var(--space-2); }
.gm-empty { color:var(--dim); padding:var(--space-4) 0; }
.gm-plain { margin-top:var(--space-4); padding-top:var(--space-3); border-top:1px solid var(--line); max-width:44rem; }
.gm-h { color:var(--dim); font-size:var(--text-xs); text-transform:uppercase; letter-spacing:.06em; margin-bottom:var(--space-2); }
.gm-pt { font-weight:var(--bold); font-size:var(--text-m); margin-bottom:var(--space-1); }
.gm-plain p { margin:var(--space-1) 0 var(--space-2); line-height:1.5; }
.gm-stale { opacity:.6; }
.gm-btn.on { border-color:var(--pick); color:var(--pick); }
.gm-btn[disabled] { opacity:.6; cursor:default; }
.gm-in { font:inherit; background:var(--control); color:var(--control-fg); border:1px solid var(--control-line); border-radius:var(--radius); padding:0 var(--space-2); min-width:0; }
.gm-cell { width:6em; text-align:center; }
.gm-mx td:has(.gm-edit), .gm-mx td:has(.gm-cell) { min-width:7em; }
.gm-edit { cursor:text; border-bottom:1px dashed var(--dim); }
.gm-new { margin-bottom:var(--space-2); }
.gm-new .gm-in { width:100%; box-sizing:border-box; }
.gm-players { margin:var(--space-2) 0; display:flex; flex-direction:column; gap:var(--space-1); }
.gm-pl { display:flex; gap:var(--space-2); align-items:center; flex-wrap:wrap; }
.gm-pn { font-weight:var(--bold); min-width:6em; }
.gm-chip { border:1px solid var(--line); border-radius:var(--radius); padding:0 var(--space-1); }
.gm-chip a, .gm-x { cursor:pointer; margin-left:var(--space-1); color:var(--dim); }
.gm-chip a:hover, .gm-x:hover { color:var(--failed); }
.gm-sel { font:inherit; background:var(--control); color:var(--control-fg); border:1px solid var(--control-line); border-radius:var(--radius); }
`);

const HUMAN = (basis: string) => ({ of: "human" as const, basis });
const key = (p: (string | null)[]) => JSON.stringify(p);

/** What the matrix marks, from an analysis: best responses by player and outcome, equilibria, dominated strategies. */
function marks(g: Game, a: Analysis) {
  const best = new Set<string>();
  for (const b of a.best_responses) {
    const i = g.players.findIndex((p) => p.name === b.player);
    for (const s of b.best) best.add(`${i}|${key(b.against.map((x, j) => (j === i ? s : x)))}`);
  }
  const ne = new Set(a.nash.map((e) => key(e.profile)));
  const dom = new Map(a.dominated.filter((d) => d.strictly).map((d) => [`${d.player}|${d.strategy}`, d.by]));
  return { best, ne, dom };
}

/**
 * A payoff as typed into a cell: one number per player, apart by commas or
 * spaces (`3, 3`, `-1 2.5`). When it isn't that, what it should be.
 */
export function parsePayoff(text: string, players: number): number[] | { error: string } {
  const parts = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (parts.length !== players) return { error: `${players} numbers, one per player, in player order` };
  const out = parts.map(Number);
  if (out.some((x) => !Number.isFinite(x))) return { error: "numbers only, such as 3, 0" };
  return out;
}

/** What an edit answers: nothing when it went through, else the refusal's words. */
type SetCell = (p: string[], text: string) => Promise<string>;

/** One payoff cell: its numbers, marked; while editing, a click makes it an input (Enter sets it, Escape leaves it). */
function Cell({ p, v, best, set }: { p: string[]; v: number[] | undefined; best: Set<string>; set?: SetCell }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  // Focused as it opens (in layout, before paint, so no keystroke is lost), its text selected: typing replaces it.
  const input = useRef<HTMLInputElement>(null);
  // Its text is set once, as it opens, never as a prop: a change landing while one types re-renders, and would put it back.
  useLayoutEffect(() => {
    if (!open || !input.current) return;
    input.current.value = v ? v.join(", ") : "";
    input.current.focus();
    input.current.select();
  }, [open]);
  if (set && open)
    return html`<span><input class="gm-in gm-cell" ref=${input} onBlur=${() => !err && setOpen(false)} placeholder=${p.map(() => "0").join(", ")}
      onKeyDown=${async (ev: any) => {
        if (ev.key === "Escape") return setOpen(false), setErr("");
        if (ev.key !== "Enter" || ev.target.readOnly) return;
        ev.target.readOnly = true;
        const said = await set(p, ev.target.value);
        ev.target.readOnly = false;
        setErr(said);
        if (!said) setOpen(false);
      }} />${err && html`<div class="gm-err gm-small">${err}</div>`}</span>`;
  const shown = !v ? html`<span>—</span>` : html`<span>${v.map((x, i) => html`${i ? ", " : ""}<span class=${best.has(`${i}|${key(p)}`) ? "br" : ""}>${x}</span>`)}</span>`;
  return set ? html`<span class="gm-edit" title="Set what this outcome is worth to each player" onClick=${() => setOpen(true)}>${shown}</span>` : shown;
}

/** The payoff matrix: two players as rows and columns; more as one row per outcome. With `set`, each cell can be edited. */
function Matrix({ g, a, set }: { g: Game; a: Analysis; set?: SetCell }) {
  const { best, ne, dom } = marks(g, a);
  const cells = new Map(g.payoffs.map((c) => [key(c.profile), c.payoff]));
  // Plain calls, not components made here: a component made in a render is new each time, and remounts (an open cell would close).
  const Pay = ({ p }: { p: string[] }) => html`<${Cell} key=${key(p)} p=${p} v=${cells.get(key(p))} best=${best} set=${set} />`;
  const Strat = ({ i, s }: { i: number; s: string }) => {
    const by = dom.get(`${g.players[i]!.name}|${s}`);
    return html`<span class=${by ? "dom" : ""} title=${by ? `strictly dominated by ${by}` : ""}>${s}</span>`;
  };
  const cls = (p: string[]) => (!cells.has(key(p)) ? "miss" : ne.has(key(p)) ? "ne" : "");
  if (g.players.length === 2) {
    const [r, c] = g.players as [Game["players"][0], Game["players"][0]];
    return html`<table class="gm-mx">
      <tr><th>${r.name} ╲ ${c.name}</th>${c.strategies.map((s) => html`<th class="p">${Strat({ i: 1, s })}</th>`)}</tr>
      ${r.strategies.map(
        (rs) => html`<tr><th class="p">${Strat({ i: 0, s: rs })}</th>${c.strategies.map((cs) => html`<td class=${cls([rs, cs])} title=${ne.has(key([rs, cs])) ? "an equilibrium" : ""}>${Pay({ p: [rs, cs] })}</td>`)}</tr>`,
      )}
    </table>`;
  }
  let all: string[][] = [[]];
  for (const p of g.players) all = all.flatMap((pre) => p.strategies.map((s) => [...pre, s]));
  return html`<table class="gm-mx">
    <tr>${g.players.map((p) => html`<th class="p">${p.name}</th>`)}<th>payoffs</th></tr>
    ${all.map((p) => html`<tr>${p.map((s, i) => html`<td>${Strat({ i, s })}</td>`)}<td class=${cls(p)}>${Pay({ p })}</td></tr>`)}
  </table>`;
}

const view: Plugin = {
  id: "game",
  about: "Games on the page: each game's payoff matrix with best responses, equilibria and dominated strategies marked.",
  inject: ["find.index", "here.read", "here.set", "slot.fill", "action.invoke"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const invoke = ctx.get<ActionInvoke>("action.invoke");

    const useIndex = () => {
      const [, tick] = useState(0);
      useEffect(() => index.watch(() => tick((x) => x + 1)) as () => void, []);
    };
    const useHere = <T extends Json>(k: string): T | undefined => {
      const [v, setV] = useState<T | undefined>(here.get<T>(k));
      useEffect(() => here.watch(k, (c) => setV(c.value as T | undefined)) as () => void, [k]);
      return v;
    };
    const asGame = (r: Row): Game => {
      const { players, payoffs } = readGame(r.fields);
      return { players, payoffs };
    };

    /** Keeps the analysis on the map, as the person at the page. */
    const Keep = ({ row, a }: { row: Row; a: Analysis }) => {
      const [said, setSaid] = useState("");
      if (!a.complete) return null;
      const go = async () => {
        const out = await invoke.invoke<{ recorded: string | null }>({ action: "game.analyze", input: { game: row.id }, authority: HUMAN("pressed Keep this analysis on the game"), reason: `Reason out ${String(row.fields.title ?? row.id)}` });
        setSaid(out.ok ? (out.change ? "kept as a finding" : "already kept") : `refused: ${out.refused.message}`);
      };
      return html`<button class="gm-btn" title="Record this analysis as a finding about the game (game.analyze), superseding the one before" onClick=${go}>Keep this analysis</button>${said && html` <span class=${said.startsWith("refused") ? "gm-err" : "gm-dim"}>${said}</span>`}`;
    };

    /** Runs a game action as the person at the page; answers nothing when it went through, else the refusal's words. */
    const act = async (action: string, input: Json, what: string, title: string): Promise<{ said: string; output?: Json }> => {
      const out = await invoke.invoke({ action, input, authority: HUMAN(`${what}, on the game's page`), reason: `${what[0]!.toUpperCase()}${what.slice(1)}${what.includes(title) ? "" : ` in ${title}`}` });
      return out.ok ? { said: "", output: out.output } : { said: out.refused.message };
    };

    /** An input that does something on Enter: cleared when it went through, else the refusal shown under it. */
    const Add = ({ placeholder, on, title }: { placeholder: string; on: (text: string) => Promise<string>; title?: string }) => {
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState(false);
      return html`<span class="gm-add"><input class="gm-in" placeholder=${placeholder} title=${title ?? ""} disabled=${busy}
        onKeyDown=${async (ev: any) => {
          if (ev.key !== "Enter" || !ev.target.value.trim() || busy) return;
          const field = ev.target;
          setBusy(true);
          const said = await on(field.value.trim());
          setBusy(false);
          setErr(said);
          if (!said) field.value = "";
          field.focus();
        }} />${err && html`<span class="gm-err"> ${err}</span>`}</span>`;
    };

    /** A name that becomes an input on a click: Enter renames it (on), Escape or leaving it keeps it. */
    const Rename = ({ name, cls, title, on }: { name: string; cls: string; title: string; on: (to: string) => Promise<string> }) => {
      const [open, setOpen] = useState(false);
      const [err, setErr] = useState("");
      const input = useRef<HTMLInputElement>(null);
      // Its text is set once, as it opens, never as a prop (see Cell).
      useLayoutEffect(() => {
        if (!open || !input.current) return;
        input.current.value = name;
        input.current.focus();
        input.current.select();
      }, [open]);
      if (!open) return html`<span class=${cls + " gm-edit"} title=${title} onClick=${() => setOpen(true)}>${name}</span>`;
      return html`<span><input class="gm-in" ref=${input} size=${Math.max(6, name.length + 2)}
        onBlur=${() => (setOpen(false), setErr(""))}
        onKeyDown=${async (ev: any) => {
          if (ev.key === "Escape") return setOpen(false), setErr("");
          if (ev.key !== "Enter" || ev.target.readOnly) return;
          const to = ev.target.value.trim();
          if (!to || to === name) return setOpen(false);
          ev.target.readOnly = true;
          const said = await on(to);
          ev.target.readOnly = false;
          setErr(said);
          if (!said) setOpen(false);
        }} />${err && html`<span class="gm-err"> ${err}</span>`}</span>`;
    };

    /** A new game from its title: two players with two strategies each, open in edit, every payoff still to set (game.create). */
    const NewGame = () =>
      html`<div class="gm-new"><${Add} placeholder="+ new game: its title" title="Make a game (game.create): two players, two strategies each, to rename and fill in"
        on=${async (title: string) => {
          const { said, output } = await act("game.create", { title, players: [{ name: "Player 1", strategies: ["A", "B"] }, { name: "Player 2", strategies: ["A", "B"] }] }, `made the game ${title}`, title);
          if (said) return said;
          editing = (output as { id: string }).id;
          set.set(KEYS.item, editing);
          return "";
        }} /></div>`;

    /** While editing: each player's strategies, to add or take out, and players to add or take out (game.strategy, game.player, game.remove). */
    const Players = ({ row, g }: { row: Row; g: Game }) => {
      const title = String(row.fields.title ?? row.id);
      const run = async (action: string, input: Json, what: string) => (await act(action, { game: row.id, ...(input as object) }, what, title)).said;
      const clears = g.payoffs.length ? `, clearing the ${g.payoffs.length} payoffs set` : "";
      return html`<div class="gm-players">
        ${g.players.map(
          (p) => html`<div class="gm-pl" key=${p.name}>
            <${Rename} name=${p.name} cls="gm-pn" title=${`Rename ${p.name} (game.rename): payoffs stay`} on=${(to: string) => run("game.rename", { player: p.name, to }, `renamed player ${p.name} to ${to}`)} />
            ${p.strategies.map((s) => html`<span class="gm-chip" key=${s}><${Rename} name=${s} cls="" title=${`Rename ${s} (game.rename): its payoffs stay`} on=${(to: string) => run("game.rename", { player: p.name, strategy: s, to }, `renamed ${p.name}'s strategy ${s} to ${to}`)} /><a title=${`Take ${s} out, with the payoffs that use it (game.remove)`} onClick=${() => run("game.remove", { player: p.name, strategy: s }, `took strategy ${s} out of ${p.name}`)}>×</a></span>`)}
            <${Add} placeholder="+ strategy" title=${`Add a strategy to ${p.name} (game.strategy)`} on=${(v: string) => run("game.strategy", { player: p.name, strategies: [v] }, `added strategy ${v} to ${p.name}`)} />
            <a class="gm-dim gm-x" title=${`Take ${p.name} out${clears} (game.remove)`} onClick=${() => run("game.remove", { player: p.name, clear: true }, `took player ${p.name} out`)}>remove player</a>
          </div>`,
        )}
        <${Add} placeholder="+ player: name" title=${`Add a player${clears} (game.player)`} on=${(v: string) => run("game.player", { name: v, clear: true }, `added player ${v}`)} />
        <span class="gm-dim">adding or removing a player clears the payoffs set; undo brings them back</span>
      </div>`;
    };

    const Whole = ({ row }: { row: Row }) => {
      const [edit, setEdit] = useState(editing === row.id);
      useEffect(() => setEdit(editing === row.id), [row.id]);
      const g = asGame(row);
      const a = analyze(g);
      const title = String(row.fields.title ?? row.id);
      const setCell: SetCell = async (p, text) => {
        const v = parsePayoff(text, g.players.length);
        if (!Array.isArray(v)) return v.error;
        return (await act("game.payoff", { game: row.id, cells: [{ profile: p, payoff: v }] }, `set what (${p.join(", ")}) is worth`, title)).said;
      };
      const findings = index
        .linksOf(row.id)
        .filter((l) => l.type === "about" && l.to === row.id)
        .map((l) => index.item(l.from))
        .filter((r): r is Row => !!r && r.type === "record" && r.fields.status === "current");
      return html`<div class="gm-main">
        <h2 title="Open on the Landscape" onClick=${() => (set.set(KEYS.view, "field/field"), set.set(KEYS.item, row.id))}>${String(row.fields.title ?? row.id)}</h2>
        <div class="gm-dim">${g.players.map((p) => `${p.name} (${p.strategies.length})`).join(" · ") || "No players yet"} · ${String(row.fields.status ?? "")}</div>
        ${typeof row.fields.note === "string" && html`<p class="gm-note">${row.fields.note}</p>`}
        <div class="gm-bar"><button class=${"gm-btn" + (edit ? " on" : "")} title="Set payoffs, and add or take out players and strategies: each change is an action, undone like any other" onClick=${() => ((editing = edit ? "" : row.id), setEdit(!edit))}>${edit ? "Done" : "Edit"}</button>${edit && html`<span class="gm-dim">click a name to rename it, a cell to set its payoffs (one number per player: 3, 0)</span>`}</div>
        ${edit && html`<${Players} row=${row} g=${g} />`}
        ${g.players.length >= 2 && html`<${Matrix} g=${g} a=${a} set=${edit ? setCell : undefined} />`}
        <div class="gm-key">underlined: a best response · ringed: an equilibrium · struck: strictly dominated · the first payoff is ${g.players[0]?.name ?? "the first player"}'s</div>
        <ul class="gm-sum">${a.summary.map((l) => html`<li>${l}</li>`)}</ul>
        <div class="gm-bar"><${Keep} row=${row} a=${a} />${findings.map((f) => html`<a class="gm-dim" title=${String(f.fields.note ?? "")} onClick=${() => (set.set(KEYS.view, "field/field"), set.set(KEYS.item, f.id))}>kept ${String(f.fields.as_of ?? "")}</a>`)}</div>
        <${Plain} row=${row} g=${g} a=${a} />
      </div>`;
    };

    /** The game in plain words: the explanation kept about it, and asking for one (explain.game, as the person at the page). */
    const Plain = ({ row, g, a }: { row: Row; g: Game; a: Analysis }) => {
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState("");
      const [models, setModels] = useState<Models | null>(null);
      const [model, setModel] = useState<string>(chosenModel);
      // The agent session the person works with: the one looked at (here.run) if live, else the only one live.
      const live = (useHere<Json>(SESSIONS) as unknown as LiveSession[] | undefined ?? []).filter((x) => !x.run.startsWith("call:") && !x.run.startsWith("calls:"));
      const looked = useHere<string>(KEYS.run);
      const [picked, setPicked] = useState<string | undefined>(undefined);
      const session = picked !== undefined ? live.find((x) => x.run === picked) : (live.find((x) => x.run === looked) ?? (live.length === 1 ? live[0] : undefined));
      useEffect(() => {
        void invoke.invoke({ action: "typed.models", input: {}, authority: HUMAN("opened a game"), reason: "List the models an explanation can be asked of" }).then((o) => o.ok && setModels(o.output as unknown as Models));
      }, []);
      const e = index
        .linksOf(row.id)
        .filter((l) => l.type === "about" && l.to === row.id)
        .map((l) => index.item(l.from))
        .find((r): r is Row => !!r && r.type === EXPLANATION && r.fields.status === "current");
      if (!a.complete) return null;
      const stale = !!e && e.fields.version !== versionOf(g);
      const ask = async () => {
        setBusy(true);
        setErr("");
        const out = await invoke.invoke({ action: "explain.game", input: { game: row.id, ...(model ? { model } : {}), ...(session ? { parent: session.run } : {}) }, authority: HUMAN("pressed Explain on the game"), reason: `Explain ${String(row.fields.title ?? row.id)} in plain words` });
        setBusy(false);
        if (!out.ok) setErr(out.refused.message.split("\n")[0]! +(session ? ` · ${session.title} hears this at its next step` : ""));
      };
      const decide = async (decision: "accepted" | "rejected") => {
        const out = await invoke.invoke({ action: "explain.decide", input: { explanation: e!.id, decision }, authority: HUMAN(`pressed ${decision === "accepted" ? "accept" : "reject"} on an explanation`), reason: `${decision === "accepted" ? "Accept" : "Reject"} the explanation of ${String(row.fields.title ?? row.id)}` });
        if (!out.ok) setErr(out.refused.message);
      };
      const chosen = (d: string) => (e && e.fields.decision === d && e.fields.decided_version === e.fields.version ? " on" : "");
      return html`<div class="gm-plain">
        <div class="gm-h">In plain words</div>
        ${e &&
        html`<div class=${stale ? "gm-stale" : ""}>
          <div class="gm-pt">${String(e.fields.title ?? "")}</div>
          ${String(e.fields.note ?? "")
            .split(/\n\s*\n/)
            .map((p) => html`<p>${p.replace(/\*\*|__/g, "")}</p>`)}
          ${stale && html`<div class="gm-dim">Said of an earlier version of the game: explain it again.</div>`}
        </div>`}
        <div class="gm-bar">
          ${models &&
          html`<select class="gm-sel" title="The model to ask" value=${model} onChange=${(ev: any) => ((chosenModel = ev.target.value), setModel(ev.target.value))}>
            <option value="">${models.default ? `server's: ${models.default}` : "server's model (none set)"}</option>
            ${models.choices.map((c) => html`<option value=${c.spec} disabled=${!c.ready}>${c.spec}${c.ready ? "" : ` (no ${c.key} on the server)`}</option>`)}
          </select>`}
          ${live.length > 0 &&
          html`<select class="gm-sel" title="The agent session this call is told to: it hears what happens here at its next step" value=${session?.run ?? ""} onChange=${(ev: any) => setPicked(ev.target.value)}>
            <option value="">no session</option>
            ${live.map((x) => html`<option value=${x.run}>for ${x.title}</option>`)}
          </select>`}
          <button class="gm-btn" disabled=${busy} title="Ask the configured model (explain.game): what the map says at game:explain sets its voice" onClick=${ask}>${busy ? "Asking the model…" : e ? "Explain again" : "Explain in plain words"}</button>
          ${e && typeof e.fields.model === "string" && html`<span class="gm-dim">by ${e.fields.model}</span>`}
          ${e && !stale && html`<button class=${"gm-btn" + chosen("accepted")} title="It rings true: the nodes said to it held" onClick=${() => decide("accepted")}>accept</button><button class=${"gm-btn" + chosen("rejected")} title="It misses: the nodes said to it failed" onClick=${() => decide("rejected")}>reject</button>`}
          ${err && html`<span class="gm-err">${err}</span>`}
        </div>
      </div>`;
    };

    const Games = () => {
      useIndex();
      const at = useHere<string>(KEYS.item);
      if (!index.ready()) return html`<div class="gm gm-empty">Reading the map…</div>`;
      const found = index.run(`type:${TYPE}`, LIMIT).items.filter((r) => r.type === TYPE);
      const shown = found.find((r) => r.id === at) ?? found[0];
      if (!shown)
        return html`<div class="gm"><div class="gm-list"><${NewGame} /></div><div class="gm-main gm-empty">No games on the map yet. Make one here, or an agent models one with <code>game.create</code>, <code>game.payoff</code> and <code>game.analyze</code> (see the game plugin's README).</div></div>`;
      return html`<div class="gm">
        <div class="gm-list"><${NewGame} />${found.map((r) => html`<div class=${r === shown ? "on" : ""} onClick=${() => set.set(KEYS.item, r.id)}>${String(r.fields.title ?? r.id)}</div>`)}</div>
        <${Whole} row=${shown} />
      </div>`;
    };

    /** On a game's item page: the matrix, small. */
    const OnItem = () => {
      useIndex();
      const at = useHere<string>(KEYS.item);
      const row = at ? index.item(at) : undefined;
      if (!row || row.type !== TYPE) return null;
      const g = asGame(row);
      const a = analyze(g);
      const eq = a.nash.map((e) => `(${e.profile.join(", ")})`).join(" ");
      return html`<div class="gm-small">
        ${g.players.length >= 2 && g.players.length <= 3 && html`<${Matrix} g=${g} a=${a} />`}
        <div class="gm-dim">${a.complete ? (eq ? `Equilibria: ${eq}` : "No pure equilibrium") : a.summary[0]}</div>
        <div class="gm-bar"><button class="gm-btn" onClick=${() => set.set(KEYS.view, VIEW)}>The game in Games ›</button><${Keep} row=${row} a=${a} /></div>
      </div>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    const fill = ctx.get<SlotFill>("slot.fill");
    fill.fill({ slot: "center", name: "games", title: "Games", view: Games });
    fill.fill({ slot: "item.actions", name: "matrix", view: OnItem });
  },
};

export default view;
