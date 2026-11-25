/**
 * The gate plugin, page side: sign in and sign up drawn over the map, as the
 * old site's gate was. One column in the middle of the page, a little above
 * centre, with nothing of the map showing: an emblem and the title, each
 * way in a row across the column, an "or" line, the address (and its code
 * or password), a passkey, the maps this browser was in before, and the
 * last lines centred.
 *
 * It opens on `#gate/sign-in` or `#gate/sign-up` (so a link anywhere, such
 * as connect's `save`, opens it), asks the server's gate what to offer, and
 * posts each step back (offer.ts). Where the server has no gate
 * (`gate.setup` gives no `at`), nothing is drawn.
 *
 * Injects action.invoke, slot.fill.
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";
import { goOf, offerOf, screenOf, type Answer, type Offer, type Screen, type Step } from "./offer.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const SETUP = "gate.setup";

const STYLE = sheet(`
.gt-gate { position:fixed; inset:0; z-index:20; overflow:auto; display:flex; background:var(--bg); color:var(--fg); pointer-events:auto; }
.gt-col { box-sizing:border-box; width:100%; max-width:calc(var(--frame-right) + 2 * var(--space-5)); margin:auto; padding:var(--space-5) var(--space-5) calc(6 * var(--space-5)); display:flex; flex-direction:column; gap:var(--space-4); }
.gt-mark { align-self:center; width:calc(4 * var(--space-5)); height:calc(4 * var(--space-5)); border-radius:var(--radius); }
.gt-gate h1 { margin:0 0 var(--space-3); text-align:center; font-size:var(--text-l); font-weight:var(--bold); }
.gt-in { box-sizing:border-box; width:100%; min-width:0; font:inherit; color:var(--control-fg); background:var(--control); border:1px solid var(--dim); border-radius:var(--radius); padding:var(--space-4); }
.gt-in:focus, .gt-way:focus-visible { outline:1px solid var(--pick); outline-offset:0; border-color:var(--pick); }
.gt-way { box-sizing:border-box; width:100%; display:flex; align-items:center; justify-content:center; gap:var(--space-3); padding:var(--space-4); font:inherit; color:var(--fg); background:none; border:1px solid var(--dim); border-radius:var(--radius); cursor:pointer; white-space:nowrap; }
.gt-way.go { border-color:var(--fg); }
.gt-way:hover { border-color:var(--pick); }
.gt-way:disabled { color:var(--dim); border-color:var(--line); cursor:default; }
.gt-way img { flex:none; width:var(--text-l); height:var(--text-l); }
.gt-or { display:flex; align-items:center; gap:var(--space-4); color:var(--dim); }
.gt-or::before, .gt-or::after { content:''; flex:1; border-top:1px solid var(--line); }
.gt-row { display:flex; align-items:center; gap:var(--space-4); min-width:0; white-space:nowrap; }
.gt-row > .gt-in { flex:1; }
.gt-row > .gt-way { width:auto; flex:none; padding:var(--space-4) var(--space-5); }
.gt-show { position:relative; }
.gt-show > .gt-in { padding-right:calc(4 * var(--space-5)); }
.gt-show > .gt-link { position:absolute; right:var(--space-4); top:50%; transform:translateY(-50%); font-size:var(--text-s); }
.gt-link, .gt-gate a { color:var(--fg); background:none; border:0; padding:0; font:inherit; cursor:pointer; text-decoration:underline; text-decoration-color:var(--dim); text-underline-offset:var(--space-1); }
.gt-foot { margin:0; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gt-foot .gt-link + .gt-link { margin-left:var(--space-4); }
.gt-dim { color:var(--dim); }
.gt-agree { display:flex; gap:var(--space-3); align-items:baseline; }
.gt-err { color:var(--failed); text-align:center; }
.gt-err:empty { display:none; }
`);

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const passkeysHere = () => typeof window.PublicKeyCredential === "function" && Boolean(navigator.credentials?.get);

const gateView: Plugin = {
  id: "gate",
  about: "Sign in and sign up drawn over the map, as the host's gate offers them.",
  inject: ["action.invoke", "slot.fill"],
  apply(ctx: Context) {
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    let at: string | undefined;
    const subs = new Set<() => void>();
    const tell = () => subs.forEach((f) => f());
    invoke.invoke({ action: SETUP, input: {}, authority: { of: "human", basis: "opened the map" }, reason: "Whether this server has a gate" }).then(
      (o) => {
        const out = o.ok ? (o.output as { at?: unknown }) : {};
        at = typeof out.at === "string" ? out.at : undefined;
        tell();
      },
      () => undefined,
    );
    ctx.effect(() => {
      addEventListener("hashchange", tell);
      return () => removeEventListener("hashchange", tell);
    });

    /** One step to the gate: its answer, or why not. `go` leaves the page. */
    const send = async (step: Step): Promise<Answer> => {
      const r = await fetch(at!, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(step) });
      const out = (await r.json().catch(() => ({}))) as Answer;
      if (!r.ok || out.error) throw new Error(typeof out.error === "string" ? out.error : `That did not work (${r.status}).`);
      const go = goOf(out.go);
      if (go) location.assign(go);
      return out;
    };

    const Gate = () => {
      const [, tick] = useState(0);
      useEffect(() => {
        const f = () => tick((x) => x + 1);
        subs.add(f);
        return () => void subs.delete(f);
      }, []);
      const open = at ? screenOf(location.hash) : undefined;
      if (!open) return null;
      return html`<${Screen} key=${open.screen} screen=${open.screen} failed=${open.failed} />`;
    };

    const Screen = ({ screen, failed }: { screen: Screen; failed?: string }) => {
      const [offer, setOffer] = useState<Offer | undefined>(undefined);
      const [error, setError] = useState(failed ?? "");
      const [agreed, setAgreed] = useState(false);
      const [busy, setBusy] = useState(false);
      const [sent, setSent] = useState(false);
      const [shown, setShown] = useState(false);
      const email = useRef<HTMLInputElement>(null);
      const password = useRef<HTMLInputElement>(null);
      const code = useRef<HTMLInputElement>(null);
      const [pw, setPw] = useState("");
      const [typedCode, setCode] = useState("");
      useEffect(() => {
        fetch(`${at}?screen=${screen}`, { credentials: "same-origin", headers: { accept: "application/json" } })
          .then((r) => r.json())
          .then((raw) => {
            const o = offerOf(raw);
            setOffer(o);
            if (o.error && !failed) setError(o.error);
          })
          .catch((e) => setError(String(e?.message ?? e)));
      }, []);
      // A passkey, offered quietly in the email field's autofill on the sign-in screen.
      useEffect(() => {
        if (!offer?.passkey || screen !== "sign-in" || !passkeysHere()) return;
        const stop = new AbortController();
        const PKC = window.PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> };
        PKC.isConditionalMediationAvailable?.().then((yes) => void (yes && passkey(stop.signal).catch(() => undefined)), () => undefined);
        return () => stop.abort();
      }, [offer]);
      if (!offer) return html`<div class="gt-gate"><div class="gt-col"><div class="gt-err">${error}</div></div></div>`;

      const step = async (s: Step) => {
        setBusy(true);
        setError("");
        try {
          return await send(s);
        } catch (e) {
          setError(String((e as Error)?.message ?? e));
          return undefined;
        } finally {
          setBusy(false);
        }
      };
      const needs = !!offer.agree && !agreed;
      const agree = offer.agree ? agreed : undefined;
      async function passkey(signal?: AbortSignal) {
        const o = await send({ step: "passkey-options", screen });
        const got = (await navigator.credentials.get({ publicKey: { challenge: unb64(o.challenge ?? ""), ...(o.rpId ? { rpId: o.rpId } : {}), userVerification: "preferred" }, ...(signal ? { mediation: "conditional", signal } : {}) } as CredentialRequestOptions)) as PublicKeyCredential;
        const r = got.response as AuthenticatorAssertionResponse;
        await send({ step: "passkey", screen, id: got.id, clientDataJSON: b64(r.clientDataJSON), authenticatorData: b64(r.authenticatorData), signature: b64(r.signature) });
      }
      const usePasskey = () => passkey().catch((e) => setError(e?.name === "NotAllowedError" ? "No passkey was used." : String(e?.message ?? e)));
      const address = () => email.current?.value.trim() ?? "";
      const submit = async (e: Event) => {
        e.preventDefault();
        if (!address()) return email.current?.focus();
        if (sent && code.current?.value.trim()) return void step({ step: "code", screen, email: address(), code: code.current.value.trim(), ...(agree !== undefined ? { agree } : {}) });
        const pw = password.current?.value;
        const out = await step({ step: "email", screen, email: address(), ...(pw ? { password: pw } : {}), ...(agree !== undefined ? { agree } : {}) });
        if (out?.sent) {
          setSent(true);
          setTimeout(() => code.current?.focus());
        }
      };
      const mail = offer.email;
      const ways = offer.providers ?? [];
      const done = screen === "sign-up" ? "Sign up" : "Sign in";
      // One button, as on most sign-in pages: a password typed signs in, a code typed is traded, else a code is mailed.
      const label = !mail?.code || pw || typedCode ? done : sent ? "Send again" : "Email me a code";
      return html`<div class="gt-gate" role="dialog" aria-label=${offer.title}><form class="gt-col" onSubmit=${submit}>
        ${offer.emblem && html`<img class="gt-mark" src=${offer.emblem} alt="" />`}
        <h1>${offer.title}</h1>
        ${offer.agree &&
        html`<label class="gt-agree"><input type="checkbox" checked=${agreed} onChange=${(e: Event) => setAgreed((e.target as HTMLInputElement).checked)} /><span>${offer.agree.text} ${offer.agree.docs.map((d, i) => html`${i === 0 ? "" : i === offer.agree!.docs.length - 1 ? " and the " : ", the "}<a href=${d.url} target="_blank" rel="noopener">${d.title}</a>`)}</span></label>`}
        ${ways.map(
          (p) => html`<button type="button" class="gt-way" disabled=${busy || needs} title=${needs ? "Tick the box first" : ""} onClick=${() => step({ step: "provider", screen, provider: p.id, ...(agree !== undefined ? { agree } : {}) })}>${p.mark && html`<img src=${p.mark} alt="" aria-hidden="true" />`}${p.label}</button>`,
        )}
        ${ways.length > 0 && mail && html`<div class="gt-or">or</div>`}
        ${mail &&
        html`<input ref=${email} class="gt-in" type="email" placeholder="Email" autocomplete=${offer.passkey ? "username webauthn" : "email"} spellcheck=${false} required />
          ${mail.password &&
          html`<div class="gt-show"><input ref=${password} class="gt-in" type=${shown ? "text" : "password"} placeholder="Password" autocomplete="current-password" onInput=${(e: Event) => setPw((e.target as HTMLInputElement).value)} /><button type="button" class="gt-link" title="Show the password" onClick=${() => setShown(!shown)}>${shown ? "Hide" : "Show"}</button></div>`}
          ${sent && html`<input ref=${code} class="gt-in" type="text" placeholder="Code from the email" autocomplete="one-time-code" autocapitalize="characters" spellcheck=${false} onInput=${(e: Event) => setCode((e.target as HTMLInputElement).value)} />`}
          <button type="submit" class="gt-way go" disabled=${busy || needs} title=${needs ? "Tick the box first" : label === "Email me a code" ? "A code is mailed to it" : ""}>${label}</button>
          ${sent && html`<p class="gt-foot gt-dim">Not there? Check spam or junk.</p>`}`}
        <div class="gt-err" role="alert">${error}</div>
        ${offer.passkey && passkeysHere() && html`<p class="gt-foot"><button type="button" class="gt-link" title="If you added one, on this device or your phone" onClick=${usePasskey}>Use a passkey</button></p>`}
        ${offer.before &&
        html`<p class="gt-foot"><span class="gt-dim">Signed in before</span> ${offer.before.map((b) => html`<button type="button" class="gt-link" title=${`Open ${b.label}`} onClick=${() => step({ step: "before", screen, id: b.id })}>${b.label}</button>`)}</p>`}
        ${(offer.foot ?? []).map((f) => html`<p class="gt-foot">${f.text && html`<span class="gt-dim">${f.text}</span> `}${f.links.map((l, i) => html`${i ? html` <span class="gt-dim">or</span> ` : ""}<a href=${l.href} title=${l.title ?? ""}>${l.label}</a>`)}</p>`)}
      </form></div>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "over", name: "gate", view: Gate });
  },
};

export default gateView;
