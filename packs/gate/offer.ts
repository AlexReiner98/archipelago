/**
 * What the gate asks and sends: plain data, no I/O. The gate is a host's
 * way in to its maps (sign in, sign up, keep a guest's map), drawn by the
 * page and answered by whatever the host runs at the configured path. It
 * holds no secret and checks nothing: it shows what the path offers and
 * posts what the person typed or chose back to it.
 *
 * - `GET <at>?screen=<screen>`: an `Offer`, what this screen shows.
 * - `POST <at>` with a `Step` (JSON): an `Answer`. `go` sends the browser
 *   there (signed in, or off to a provider); `sent` means a code was mailed
 *   and the code box opens; `error` is said under the form.
 *
 * Everything an offer names that the browser follows (a link, a mark's
 * picture, where `go` leads) must be on this page's origin, or, for `go`
 * alone, https: what isn't is dropped (`offerOf`, `goOf`).
 */

/** The screens a gate draws. `#gate/<screen>` opens one. */
export const SCREENS = ["sign-in", "sign-up"] as const;
export type Screen = (typeof SCREENS)[number];

export interface Offer {
  title: string;
  /** A picture over the title, a path on this origin. */
  emblem?: string;
  /** A box to tick before any way in: its words, then each document linked. */
  agree?: { text: string; docs: { title: string; url: string }[] };
  /** Ways in through another site, each a row; `mark`, a picture on this origin. */
  providers?: { id: string; label: string; mark?: string }[];
  /** An address: `code`, a code is mailed and typed here; `password`, a password beside it. */
  email?: { code?: boolean; password?: boolean };
  /** Whether a passkey is taken here. */
  passkey?: boolean;
  /** Maps this browser was in before, a click each. */
  before?: { id: string; label: string }[];
  /** Last lines under the form, each words and links. */
  foot?: { text?: string; links: { label: string; href: string; title?: string }[] }[];
  /** Said under the form as it opens (a provider sent the person back with why not). */
  error?: string;
}

export type Step =
  | { step: "provider"; screen: Screen; provider: string; agree?: boolean }
  | { step: "email"; screen: Screen; email: string; password?: string; agree?: boolean }
  | { step: "code"; screen: Screen; email: string; code: string; agree?: boolean }
  | { step: "before"; screen: Screen; id: string }
  | { step: "passkey-options"; screen: Screen }
  | { step: "passkey"; screen: Screen; id: string; clientDataJSON: string; authenticatorData: string; signature: string };

export interface Answer {
  go?: string;
  sent?: boolean;
  error?: string;
  /** For `passkey-options`: what the browser signs. */
  challenge?: string;
  rpId?: string;
}

const str = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.length <= max ? v : undefined);
/** A path on this origin, or a fragment: never another site, never `//`. */
export const local = (v: unknown): string | undefined => {
  const s = str(v, 2000);
  return s && ((s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\")) || s.startsWith("#")) ? s : undefined;
};
/** Where `go` may send the browser: this origin, or a provider over https. */
export const goOf = (v: unknown): string | undefined => {
  const s = str(v, 4000);
  if (!s) return undefined;
  if (local(s)) return s;
  try {
    return new URL(s).protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
};

/** An offer as the path sent it, kept to what the gate draws, with what it would follow checked. */
export function offerOf(raw: unknown): Offer {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = <T>(v: unknown, f: (x: Record<string, unknown>) => T | undefined): T[] => (Array.isArray(v) ? v.slice(0, 20).map((x) => (x && typeof x === "object" ? f(x as Record<string, unknown>) : undefined)).filter((x): x is T => x !== undefined) : []);
  const out: Offer = { title: str(o.title, 80) ?? "Sign in" };
  const emblem = local(o.emblem);
  if (emblem) out.emblem = emblem;
  if (o.agree && typeof o.agree === "object") {
    const a = o.agree as Record<string, unknown>;
    out.agree = { text: str(a.text) ?? "I agree to", docs: list(a.docs, (d) => (str(d.title) && typeof d.url === "string" && /^https?:\/\/|^\//.test(d.url) ? { title: str(d.title)!, url: d.url } : undefined)) };
  }
  const providers = list(o.providers, (p) => (str(p.id, 40) && str(p.label, 80) ? { id: str(p.id, 40)!, label: str(p.label, 80)!, ...(local(p.mark) ? { mark: local(p.mark)! } : {}) } : undefined));
  if (providers.length) out.providers = providers;
  if (o.email && typeof o.email === "object") {
    const e = o.email as Record<string, unknown>;
    out.email = { code: e.code === true, password: e.password === true };
  }
  if (o.passkey === true) out.passkey = true;
  const before = list(o.before, (b) => (str(b.id, 80) && str(b.label) ? { id: str(b.id, 80)!, label: str(b.label)! } : undefined));
  if (before.length) out.before = before;
  const foot = list(o.foot, (f) => {
    const links = list(f.links, (l) => (str(l.label, 80) && local(l.href) ? { label: str(l.label, 80)!, href: local(l.href)!, ...(str(l.title) ? { title: str(l.title)! } : {}) } : undefined));
    return links.length || str(f.text) ? { ...(str(f.text) ? { text: str(f.text)! } : {}), links } : undefined;
  });
  if (foot.length) out.foot = foot;
  const error = str(o.error, 300);
  if (error) out.error = error;
  return out;
}

/** The screen a page address opens, and why a provider sent the person back, if it did: `#gate/sign-up?failed=…`. */
export function screenOf(hash: string): { screen: Screen; failed?: string } | undefined {
  const m = /^#gate\/([a-z-]+)(?:\?(.*))?$/.exec(hash);
  const screen = SCREENS.find((s) => s === m?.[1]);
  if (!screen) return undefined;
  const failed = new URLSearchParams(m?.[2] ?? "").get("failed") ?? undefined;
  return failed ? { screen, failed } : { screen };
}
