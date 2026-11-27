/**
 * Page side of the claim plugin: the shared plan, drawn. The plan comes from
 * the server's `claim.read` (over the bridge) into the page key `claim.plan`,
 * so any view or look can read it by name; the fill "Shared plan" in center
 * draws it from that key.
 *
 * One plan at a time (a tab per plan when there are more), and one round of
 * it: a stretch when agents worked on it together, its intents overlapping or
 * a few minutes apart (a tab per round, the latest first). It shows as lanes
 * on a time line: a lane per agent, in its run colour, with its branch. Each
 * intent is a bar from its claim to its end: solid while held, faint once
 * done, dashed when dropped. A wait pulses in its lane until it is let in,
 * and stays as a dotted lead-in to the intent it became; a
 * write turned away is a ✕ where it happened; a curve runs from the intent
 * a wait was for to the intent built on it. Under it, what is held now,
 * file by file, and the writes turned away.
 *
 * A click on an agent opens its run in the Sensory interface; on an intent,
 * its item.
 *
 * Injects claim.read, here.read, here.set, here.declare, slot.fill.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { Json } from "../../spec/common.ts";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { colourOf, colours } from "../harness/live.ts";
import type { ClaimRead } from "./index.ts";
import { ROUND_GAP, rounds, scopeTitle, type Hold, type IntentView, type PlanState, type PlanView } from "./plan.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const PLAN_KEY = "claim.plan";
const HARNESS = "harness/view";
/** A lane's height, px: the curves between lanes are drawn in these units. */
const LANE = 46;
/** The shortest span drawn, ms, so a plan of a few seconds still reads. */
const MIN_SPAN = 20_000;

const STYLE = sheet(`
.sp { padding:var(--space-4, 12px) var(--space-5, 16px); overflow:auto; height:100%; box-sizing:border-box; font-variant-numeric:tabular-nums; }
.sp-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
.sp-tab { border:1px solid var(--line); background:none; color:var(--dim); border-radius:var(--radius, 6px); padding:3px 10px; cursor:pointer; font:inherit; font-size:var(--text-s, 12px); }
.sp-tab[aria-pressed="true"] { color:var(--fg); border-color:var(--fg); }
.sp-head { display:flex; align-items:baseline; gap:18px; flex-wrap:wrap; margin-bottom:14px; }
.sp-title { font-size:var(--text-l, 18px); font-weight:var(--bold, 600); }
.sp-tally { color:var(--dim); font-size:var(--text-s, 12px); }
.sp-tally b { color:var(--fg); font-weight:var(--bold, 600); font-size:var(--text-m, 14px); margin-right:3px; }
.sp-board { display:grid; grid-template-columns:minmax(120px, 190px) 1fr; column-gap:12px; }
.sp-who { height:${LANE}px; display:flex; flex-direction:column; justify-content:center; min-width:0; cursor:pointer; border-bottom:1px solid color-mix(in srgb, var(--line) 50%, transparent); }
.sp-who:hover .sp-name { text-decoration:underline; }
.sp-name { font-weight:var(--bold, 600); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sp-branch { font-family:var(--mono, monospace); font-size:var(--text-xs, 11px); color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sp-live { display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:5px; vertical-align:middle; }
.sp-track { position:relative; }
.sp-lane { position:relative; height:${LANE}px; border-bottom:1px solid color-mix(in srgb, var(--line) 50%, transparent); }
.sp-bar { position:absolute; top:7px; height:${LANE - 14}px; box-sizing:border-box; border-radius:var(--radius, 6px); padding:2px 8px; overflow:hidden; cursor:pointer; display:flex; flex-direction:column; justify-content:center; min-width:6px; }
.sp-bar:hover { outline:1px solid var(--fg); }
.sp-bar-title { font-size:var(--text-s, 12px); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sp-bar-files { font-family:var(--mono, monospace); font-size:var(--text-xs, 10px); opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sp-doing { color:var(--fg); }
.sp-done { color:var(--dim); }
.sp-dropped { background:none !important; border:1px dashed var(--line); color:var(--dim); text-decoration:line-through; }
.sp-wait { position:absolute; top:${LANE / 2 - 5}px; height:10px; border-radius:5px; background:repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 8px); opacity:.6; animation:sp-pulse 1.4s ease-in-out infinite; }
.sp-wait-label { position:absolute; top:2px; font-size:var(--text-xs, 10px); color:var(--dim); white-space:nowrap; }
.sp-x { position:absolute; top:1px; transform:translateX(-50%); color:var(--failed); font-weight:var(--bold, 600); font-size:var(--text-s, 12px); cursor:default; }
.sp-now { position:absolute; top:0; bottom:0; width:0; border-left:1px dashed var(--dim); }
.sp-links { position:absolute; left:0; top:0; width:100%; pointer-events:none; overflow:visible; }
.sp-end { position:absolute; width:7px; height:7px; border-radius:50%; transform:translate(-50%, -50%); background:var(--fg); }
.sp-axis { grid-column:2; display:flex; justify-content:space-between; color:var(--dim); font-size:var(--text-xs, 11px); padding-top:4px; }
.sp-waited { animation:none; opacity:.45; }
.sp-legend { grid-column:2; display:flex; gap:16px; flex-wrap:wrap; color:var(--dim); font-size:var(--text-xs, 11px); padding-top:8px; align-items:center; }
.sp-legend span { display:inline-flex; align-items:center; gap:5px; }
.sp-key { display:inline-block; width:18px; height:9px; border-radius:3px; }
.sp-key-doing { background:color-mix(in srgb, var(--fg) 35%, var(--bg)); border-left:3px solid var(--fg); }
.sp-key-done { background:color-mix(in srgb, var(--fg) 12%, var(--bg)); border-left:3px solid var(--dim); }
.sp-key-wait { background:repeating-linear-gradient(90deg, var(--dim) 0 3px, transparent 3px 6px); }
.sp-story { margin-top:6px; border-left:2px solid var(--line); padding-left:12px; }
.sp-ev { padding:3px 0; font-size:var(--text-s, 12px); line-height:1.45; }
.sp-ev-t { color:var(--dim); margin-right:8px; font-family:var(--mono, monospace); font-size:var(--text-xs, 11px); }
.sp-ev-new { animation:sp-in .6s ease-out; }
@keyframes sp-in { from { background:color-mix(in srgb, var(--fg) 18%, transparent); } }
@media (prefers-reduced-motion: reduce) { .sp-ev-new { animation:none; } }
@keyframes sp-pulse { 50% { opacity:.25; } }
@media (prefers-reduced-motion: reduce) { .sp-wait { animation:none; } }
.sp-h { margin:22px 0 6px; font-weight:var(--bold, 600); }
.sp-held { border-collapse:collapse; }
.sp-held td { padding:3px 14px 3px 0; vertical-align:top; }
.sp-held td.sp-file { font-family:var(--mono, monospace); font-size:var(--text-s, 12px); }
.sp-chip { display:inline-block; margin-right:8px; white-space:nowrap; }
.sp-line { padding:2px 0; font-size:var(--text-s, 12px); }
.sp-dim { color:var(--dim); }
.sp-empty { color:var(--dim); max-width:62ch; line-height:1.5; }
`);

/** A time as the person reads it: their own clock, 24-hour. */
const local = (t: string | number, seconds = true) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false });
const clock = (iso: string) => local(iso);
const span = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

const plugin: Plugin = {
  id: "claim",
  about: "The shared plan agents agreed on, kept on the map: each agent's intents on a time line, what each built on, and what is held now.",
  inject: ["claim.read", "here.read", "here.set", "here.declare", "slot.fill"],
  apply(ctx: Context) {
    const read = ctx.get<ClaimRead>("claim.read");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    ctx.effect(() => ctx.get<HereDeclare>("here.declare").declare({ key: PLAN_KEY, scope: "page", doc: "The shared plan of the agents (plugins/claim): plans with their intents, what is held now, the waits and the writes turned away." }));

    const put = (p: PlanState) => set.set(PLAN_KEY, p as unknown as Json);
    void Promise.resolve(read.plan()).then(put);
    ctx.effect(() => read.watch(put));

    let slots = new Map<string, number>();
    const hue = (run: string) => colourOf(slots.get(run) ?? 0);

    /** One plan as lanes on a time line. */
    const Board = ({ plan, state, now, latest, from }: { plan: PlanView; state: PlanState; now: number; latest: boolean; from: number }) => {
      // What is live now belongs to the latest round; a write turned away, to the round it happened in.
      const waits = latest ? (state.waits ?? []).filter((w) => w.scope === plan.scope) : [];
      const turned = state.turned.filter((t) => t.scope === plan.scope && Date.parse(t.time) >= from - ROUND_GAP && (latest || plan.intents.some((i) => Date.parse(t.time) <= Date.parse(i.ended ?? t.time))));
      const loose = latest ? state.holds.filter((x) => x.scope === plan.scope && x.how === "on_write") : [];
      // Lanes: each agent in the order it first came up.
      const lanes: { run: string; title: string; branch?: string; live: boolean }[] = [];
      const lane = (run: string, title: string, branch?: string) => {
        const l = lanes.find((x) => x.run === run);
        if (!l) lanes.push({ run, title, branch, live: false });
        else if (!l.branch && branch) l.branch = branch;
      };
      for (const i of plan.intents) lane(i.run, i.agent, i.branch);
      for (const w of waits) lane(w.run, w.title, w.branch);
      for (const t of turned) (lane(t.holder, t.holder_title), lane(t.run, t.title));
      for (const x of loose) lane(x.run, x.title, x.branch);
      for (const l of lanes) l.live = plan.intents.some((i) => i.run === l.run && i.status === "doing") || waits.some((w) => w.run === l.run) || loose.some((x) => x.run === l.run);
      slots = colours(lanes.map((l) => l.run), slots);
      const row = (run: string) => lanes.findIndex((l) => l.run === run);

      // The time line: from the first claim to now while anything is live, else to the last end.
      const live = lanes.some((l) => l.live);
      const times = [...plan.intents.flatMap((i) => [i.asked ?? "", i.since, i.ended ?? ""]), ...waits.map((w) => w.since), ...turned.map((t) => t.time)].filter(Boolean).map((t) => Date.parse(t));
      const t0 = Math.min(...times, now);
      const t1 = Math.max(live ? now : t0, ...times, t0 + MIN_SPAN);
      const x = (t: string | number) => (((typeof t === "string" ? Date.parse(t) : t) - t0) / (t1 - t0)) * 100;
      const endOf = (i: IntentView) => (i.ended ? Date.parse(i.ended) : now);
      const byId = new Map(plan.intents.map((i) => [i.id, i]));

      const bar = (i: IntentView) => {
        const left = x(i.since);
        const width = Math.max(x(endOf(i)) - left, 0.8);
        const c = hue(i.run);
        const after = i.after.map((a) => byId.get(a)).filter((a): a is IntentView => !!a);
        const tip = [`${i.title} (${i.status})`, `files: ${i.files.join(", ")}`, i.branch ? `branch: ${i.branch}` : "", i.asked ? `waited ${span(Date.parse(i.since) - Date.parse(i.asked))} first` : "", ...after.map((a) => `built on ${a.agent}: ${a.title}`), `${clock(i.since)}${i.ended ? `–${clock(i.ended)}` : " – now"}`].filter(Boolean).join("\n");
        const bg = i.status === "doing" ? `color-mix(in srgb, ${c} 32%, var(--bg))` : `color-mix(in srgb, ${c} 13%, var(--bg))`;
        return html`<div key=${i.id} class=${`sp-bar sp-${i.status}`} style=${{ left: `${left}%`, width: `${width}%`, background: bg, borderLeft: i.status === "dropped" ? undefined : `3px solid ${c}` }} title=${tip} onClick=${() => set.set(KEYS.item, i.id)}>
          <span class="sp-bar-title">${i.title}</span>
          <span class="sp-bar-files">${i.files.join("  ")}</span>
        </div>`;
      };

      // Curves from the end of an intent waited for to the start of the one built on it.
      const H = lanes.length * LANE;
      const curves = plan.intents.flatMap((i) =>
        i.after.flatMap((a) => {
          const on = byId.get(a);
          if (!on) return [];
          const [x1, y1, x2, y2] = [x(endOf(on)), row(on.run) * LANE + LANE / 2, x(i.since), row(i.run) * LANE + LANE / 2];
          const bend = Math.max(Math.abs(x2 - x1) / 2, 2);
          return [{ key: `${a}>${i.id}`, d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, x2, y2 }];
        }),
      );

      const open = (run: string) => (set.set(KEYS.run, run), set.set(KEYS.view, HARNESS));
      return html`<div class="sp-board">
        <div>${lanes.map(
          (l) => html`<div key=${l.run} class="sp-who" onClick=${() => open(l.run)} title=${`open ${l.title} in the Sensory interface`}>
            <span class="sp-name" style=${{ color: hue(l.run) }}><span class="sp-live" style=${{ background: l.live ? hue(l.run) : "transparent", border: `1px solid ${hue(l.run)}` }}></span>${l.branch ? `⎇ ${l.branch}` : l.title}</span>
            <span class="sp-branch" title=${l.title}>${l.branch ? l.title : l.live ? "working" : "ended"}</span>
          </div>`,
        )}</div>
        <div class="sp-track">
          ${lanes.map(
            (l) => html`<div key=${l.run} class="sp-lane">
              ${plan.intents
                .filter((i) => i.run === l.run && i.asked)
                .map(
                  (i) => html`<div key=${`a${i.id}`} class="sp-wait sp-waited" style=${{ left: `${x(i.asked!)}%`, width: `${Math.max(x(i.since) - x(i.asked!), 0.4)}%`, color: hue(l.run) }} title=${`waited ${span(Date.parse(i.since) - Date.parse(i.asked!))} for ${i.files.join(", ")}`}></div>`,
                )}
              ${plan.intents.filter((i) => i.run === l.run).map(bar)}
              ${waits
                .filter((w) => w.run === l.run)
                .map(
                  (w) => html`<div key=${`w${w.since}`} class="sp-wait" style=${{ left: `${x(w.since)}%`, width: `${Math.max(x(now) - x(w.since), 0.8)}%`, color: hue(l.run) }} title=${`waiting for ${w.files.join(", ")} (${w.intent})`}></div>
                    <span class="sp-wait-label" style=${{ left: `${x(w.since)}%` }}>waiting · ${w.files.join(", ")}</span>`,
                )}
              ${turned
                .filter((t) => t.run === l.run)
                .map(
                  (t, k) => html`<span key=${`x${k}`} class="sp-x" style=${{ left: `${x(t.time)}%` }} title=${`${t.tool} ${t.file} turned away at ${clock(t.time)}: held by ${t.holder_title}${t.intent ? ` (${t.intent})` : ""}`}>✕</span>`,
                )}
            </div>`,
          )}
          <svg class="sp-links" viewBox=${`0 0 100 ${H}`} preserveAspectRatio="none" style=${{ height: `${H}px` }} aria-hidden="true">
            ${curves.map((c) => html`<path key=${c.key} d=${c.d} fill="none" stroke="var(--fg)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" />`)}
          </svg>
          ${curves.map((c) => html`<span key=${`e${c.key}`} class="sp-end" style=${{ left: `${c.x2}%`, top: `${c.y2}px` }} title="built on the intent this curve comes from"></span>`)}
          ${live ? html`<div class="sp-now" style=${{ left: `${x(now)}%` }} title="now"></div>` : null}
        </div>
        <div class="sp-axis"><span>${local(t0)}</span><span>${span(t1 - t0)}</span><span>${live ? "now" : local(t1)}</span></div>
        <div class="sp-legend">
          <span><i class="sp-key sp-key-doing"></i>holding its files</span>
          <span><i class="sp-key sp-key-done"></i>done</span>
          <span><i class="sp-key sp-key-wait"></i>waiting for another agent's files</span>
          <span><svg width="26" height="10" aria-hidden="true"><path d="M1 2 C 12 2, 14 8, 24 8" fill="none" stroke="var(--fg)" stroke-dasharray="3 2" /></svg>built on it (merged its work first)</span>
          <span><b style=${{ color: "var(--failed)" }}>✕</b> a write turned away</span>
        </div>
      </div>`;
    };

    /** What happened in this round, in order, in words: claims, writes turned away, waits, ends, and what was built on what. */
    const Story = ({ plan, state, from, latest }: { plan: PlanView; state: PlanState; from: number; latest: boolean }) => {
      const label = (run: string, fallback: string) => {
        const i = plan.intents.find((x) => x.run === run && x.branch);
        return i?.branch ?? (state.waits ?? []).find((w) => w.run === run)?.branch ?? state.holds.find((x) => x.run === run && x.branch)?.branch ?? fallback;
      };
      const who = (run: string, fallback: string) => html`<b style=${{ color: hue(run) }}>${label(run, fallback)}</b>`;
      const files = (fs: string[]) => html`<code>${fs.join(", ")}</code>`;
      const byId = new Map(plan.intents.map((i) => [i.id, i]));
      const ev: { t: string; key: string; body: unknown }[] = [];
      for (const i of plan.intents) {
        const on = i.after.map((a) => byId.get(a)).filter((a): a is IntentView => !!a);
        const holders = on.length ? on : [];
        if (i.asked)
          ev.push({ t: i.asked, key: `a${i.id}`, body: html`${who(i.run, i.agent)} asked for ${files(i.files)}, held by ${holders.length ? holders.map((h, k) => html`${k ? ", " : ""}${who(h.run, h.agent)}`) : "another agent"}: it waits rather than leave its task half done` });
        ev.push({
          t: i.since,
          key: `s${i.id}`,
          body: html`${who(i.run, i.agent)} ${i.asked ? "got them and claimed" : "claimed"} ${files(i.files)}: <i>“${i.title}”</i>${on.length ? html`, building on ${on.map((h, k) => html`${k ? ", " : ""}${who(h.run, h.agent)}`)}${on.some((h) => h.branch && h.branch !== i.branch) ? html` (told to <code>git merge ${on.map((h) => h.branch).filter(Boolean).join(" ")}</code> first)` : null}` : null}`,
        });
        if (i.ended) ev.push({ t: i.ended, key: `e${i.id}`, body: html`${who(i.run, i.agent)} ${i.status === "dropped" ? "let go of" : "finished"} <i>“${i.title}”</i>${i.status === "dropped" ? " without writing there" : ""}: its files are free` });
      }
      for (const [k, t] of state.turned.filter((t) => t.scope === plan.scope && Date.parse(t.time) >= from - ROUND_GAP).entries())
        ev.push({ t: t.time, key: `x${k}${t.time}`, body: html`${who(t.run, t.title)} tried to ${t.tool === "Write" ? "write" : "edit"} <code>${t.file}</code>: <span style=${{ color: "var(--failed)" }}>turned away</span>, ${who(t.holder, t.holder_title)} holds it${t.intent ? html` for <i>“${t.intent}”</i>` : null}` });
      if (latest)
        for (const w of (state.waits ?? []).filter((w) => w.scope === plan.scope))
          if (!plan.intents.some((i) => i.run === w.run && i.asked === w.since))
            ev.push({ t: w.since, key: `w${w.run}${w.since}`, body: html`${who(w.run, w.title)} is waiting for ${files(w.files)}…` });
      if (!ev.length) return null;
      ev.sort((a, b) => a.t.localeCompare(b.t));
      const fresh = Date.now() - 4000;
      return html`<div class="sp-h">What happened</div>
        <div class="sp-story">${ev.map((e) => html`<div key=${e.key} class=${`sp-ev${Date.parse(e.t) > fresh ? " sp-ev-new" : ""}`}><span class="sp-ev-t">${clock(e.t)}</span>${e.body}</div>`)}</div>`;
    };

    /** What is held now, file by file: who holds it and how, and who waits. */
    const HeldNow = ({ plan, state }: { plan: PlanView; state: PlanState }) => {
      const holds = state.holds.filter((x) => x.scope === plan.scope);
      const waits = (state.waits ?? []).filter((w) => w.scope === plan.scope);
      const files = [...new Set([...holds.map((x) => x.file), ...waits.flatMap((w) => w.files)])].sort();
      if (!files.length) return null;
      const chip = (x: Hold) =>
        html`<span class="sp-chip" style=${{ color: hue(x.run) }} title=${x.how === "claimed" ? `claimed${x.intent ? `: ${x.intent}` : ""}` : "held on its first write"}>${x.how === "claimed" ? "●" : "○"} ${x.title}</span>`;
      return html`<div class="sp-h">Held now</div>
        <table class="sp-held"><tbody>${files.map(
          (f) =>
            html`<tr key=${f}><td class="sp-file">${f}</td><td>${holds.filter((x) => x.file === f).map(chip)}${waits
              .filter((w) => w.files.includes(f))
              .map((w) => html`<span class="sp-chip" style=${{ color: hue(w.run) }} title="waiting for it">◌ ${w.title}</span>`)}</td></tr>`,
        )}</tbody></table>`;
    };

    const View = () => {
      const [state, setState] = useState<PlanState | undefined>(here.get<Json>(PLAN_KEY) as unknown as PlanState | undefined);
      const [pick, setPick] = useState<string | undefined>();
      const [round, setRound] = useState<number | undefined>();
      const [now, setNow] = useState(Date.now());
      useEffect(() => here.watch(PLAN_KEY, (c) => setState(c.value as unknown as PlanState | undefined)) as () => void, []);
      const live = !!state && ((state.holds ?? []).length > 0 || (state.waits ?? []).length > 0);
      // The time line moves while anything is held or waiting.
      useEffect(() => {
        setNow(Date.now());
        if (!live) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
      }, [live, state]);
      if (!state) return html`<div class="sp sp-empty">Reading the plan…</div>`;
      const plans = state.plans ?? [];
      if (!plans.length)
        return html`<div class="sp"><div class="sp-empty">No shared plan yet. When two or more agents work on one repository (one folder, or worktrees of it), each is told to claim what it will write, with what it means to do (<code>claim.take</code>). Each claim is an intent on the map, part of the repository's plan, and shows here as a bar in its agent's lane: who works on what, who waited for whom, and what each built on.</div></div>`;
      const whole = plans.find((p) => p.id === pick) ?? plans[0]!;
      // The plan in rounds: the latest shows unless one is picked.
      const all = rounds(whole.intents, now);
      const at = round !== undefined && round < all.length ? round : all.length - 1;
      const shown = all[at] ?? { start: now, end: now, intents: [] };
      const plan: PlanView = { ...whole, intents: shown.intents };
      const intents = plan.intents;
      const agents = new Set(intents.map((i) => i.run)).size;
      // Held and waiting are now: they belong to the latest round, never to one that is over.
      const latest = at === all.length - 1;
      const held = latest ? state.holds.filter((x) => x.scope === plan.scope).length : 0;
      const waiting = latest ? (state.waits ?? []).filter((w) => w.scope === plan.scope).length : 0;
      const turned = state.turned.filter((t) => t.scope === plan.scope && Date.parse(t.time) >= shown.start - ROUND_GAP && Date.parse(t.time) <= shown.end + ROUND_GAP);
      const built = intents.reduce((n, i) => n + i.after.length, 0);
      return html`<div class="sp">
        ${plans.length > 1
          ? html`<div class="sp-tabs">${plans.map((p) => html`<button key=${p.id} class="sp-tab" aria-pressed=${p.id === plan.id} onClick=${() => (setPick(p.id), setRound(undefined))}>${scopeTitle(p.scope)}</button>`)}</div>`
          : null}
        ${all.length > 1
          ? html`<div class="sp-tabs" aria-label="rounds">${all
              .map((r, k) => ({ r, k }))
              .reverse()
              .slice(0, 10)
              .map(({ r, k }) => {
                const n = new Set(r.intents.map((i) => i.run)).size;
                return html`<button key=${k} class="sp-tab" aria-pressed=${k === at} onClick=${() => setRound(k)} title=${`round ${k + 1} of ${all.length}`}>${k === all.length - 1 ? "latest · " : ""}${local(r.start, false)} · ${n} agent${n === 1 ? "" : "s"}</button>`;
              })}</div>`
          : null}
        <div class="sp-head">
          <span class="sp-title">${plan.title}</span>
          <span class="sp-tally"><b>${agents}</b>agent${agents === 1 ? "" : "s"}</span>
          <span class="sp-tally"><b>${intents.length}</b>intent${intents.length === 1 ? "" : "s"}</span>
          <span class="sp-tally"><b>${built}</b>built on another</span>
          ${latest ? html`<span class="sp-tally"><b>${held}</b>file${held === 1 ? "" : "s"} held</span>` : null}
          ${waiting ? html`<span class="sp-tally"><b>${waiting}</b>waiting</span>` : null}
          <span class="sp-tally"><b>${turned.length}</b>write${turned.length === 1 ? "" : "s"} turned away</span>
        </div>
        <${Board} plan=${plan} state=${state} now=${now} latest=${at === all.length - 1} from=${shown.start} />
        <${Story} plan=${plan} state=${state} from=${shown.start} latest=${at === all.length - 1} />
        ${at === all.length - 1 ? html`<${HeldNow} plan=${plan} state=${state} />` : null}
      </div>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "center", name: "plan", title: "Shared plan", view: View });
  },
};

export default plugin;
