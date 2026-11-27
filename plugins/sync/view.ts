/**
 * The sync plugin, page side: one line in the header for the map this one
 * last synced with, `⇄ hosted · 4 min ago · 2 conflicts`; opened, every
 * peer and what its last run did: sets each way, and each field both maps
 * changed with the value kept. The copies themselves are in the Activity
 * view, under agent:sync/<the other map>, each with its undo. Nothing while
 * the map has never synced.
 *
 * Asks `sync.status` when it mounts and each minute. Injects action.invoke
 * and slot.fill. Writes nothing.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { Json } from "../../spec/common.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";
import type { Peer } from "./index.ts";
import type { Report } from "./run.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export interface Status {
  id: string;
  name: string;
  peers: Peer[];
}

/** A run's report as a map keeps it: which side it was. */
type Kept = Report & { at: string; mine: "a" | "b" };

/** "just now", "4 min ago", "3 h ago", "2 d ago". */
export function ago(at: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(at)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** One peer's last run, from this map's side: sets in and out, and what both changed. */
export function runOf(peer: Peer): { got: number; gave: number; conflicts: { what: string; kept: string }[] } | undefined {
  const r = peer.report as unknown as Kept | undefined;
  if (!r || !r.a || !r.b) return undefined;
  const me = r.mine === "a" ? r.a : r.b, them = r.mine === "a" ? r.b : r.a;
  const said = (v: { value?: Json; gone?: true }) => (v.gone ? "taken away" : v.value === undefined ? "unset" : JSON.stringify(v.value).slice(0, 80));
  return {
    got: them.sent,
    gave: me.sent,
    conflicts: (r.conflicts ?? []).map((c) => ({
      what: `${c.title ?? c.id}${c.field ? ` · ${c.field}` : ""}`,
      kept: `${c.won === r.mine ? "this map's" : `${them.name}'s`}: ${said(c.won === "a" ? c.a : c.b)}`,
    })),
  };
}

/** The header's words, or nothing for a map that never synced. */
export function lineOf(s: Status | undefined, now: number): string | undefined {
  const p = s?.peers.find((x) => x.synced);
  if (!p) return undefined;
  const run = runOf(p);
  const n = run?.conflicts.length ?? 0;
  return [`⇄ ${p.name}`, ago(p.synced!, now), n ? `${n} conflict${n === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
}

const STYLE = sheet(`
.sy { position:relative; color:var(--dim); white-space:nowrap; }
.sy > summary { cursor:pointer; list-style:none; }
.sy > summary::-webkit-details-marker { display:none; }
.sy[open] > summary { color:var(--fg); }
.sy .pop { position:absolute; right:0; top:calc(100% + 6px); z-index:20; min-width:22em; max-width:34em; max-height:60vh; overflow:auto; white-space:normal;
  background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:var(--radius); padding:var(--space-3) var(--space-4); display:flex; flex-direction:column; gap:var(--space-2); }
.sy .peer b { font-weight:600; }
.sy .peer .d { color:var(--dim); font-size:var(--text-s); }
.sy ul { margin:0; padding-left:1.1em; font-size:var(--text-s); }
.sy .hint { color:var(--dim); font-size:var(--text-s); }
`);

const syncView: Plugin = {
  id: "sync",
  about: "Shows which map this one syncs with, when it last did, and what both had changed.",
  inject: ["action.invoke", "slot.fill"],
  apply(ctx: Context) {
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const ask = () =>
      invoke
        .invoke({ action: "sync.status", input: {}, authority: { of: "human", basis: "the header says what this map syncs with" }, reason: "show sync status" })
        .then((out) => (out.ok ? (out.output as unknown as Status) : undefined))
        .catch(() => undefined);

    const Line = () => {
      const [status, setStatus] = useState<Status | undefined>();
      const [now, setNow] = useState(Date.now());
      useEffect(() => {
        let live = true;
        const tick = () => void ask().then((s) => live && (setStatus(s), setNow(Date.now())));
        tick();
        const t = setInterval(tick, 60_000);
        return () => {
          live = false;
          clearInterval(t);
        };
      }, []);
      const line = lineOf(status, now);
      if (!line || !status) return null;
      return html`<details class="sy">
        <summary title="What this map syncs with: npm run map -- sync">${line}</summary>
        <div class="pop">
          ${status.peers.map((p) => {
            const run = runOf(p);
            return html`<div class="peer" key=${p.id}>
              <div><b>${p.name}</b> <span class="d">${p.synced ? ago(p.synced, now) : "never"}${run ? ` · ${run.got} in, ${run.gave} out` : ""}</span></div>
              ${run?.conflicts.length
                ? html`<div class="d">Changed on both, the later kept:</div><ul>${run.conflicts.map((c, i) => html`<li key=${i}>${c.what}: ${c.kept}</li>`)}</ul>`
                : html`<div class="d">Nothing changed on both.</div>`}
            </div>`;
          })}
          <div class="hint">Each copy is in Activity under agent:sync/…, with its undo. Sync again: <code>npm run map -- sync ${status.peers[0]?.name ?? "<map|url>"}</code></div>
        </div>
      </details>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "top", name: "sync", view: Line });
  },
};

export default syncView;
