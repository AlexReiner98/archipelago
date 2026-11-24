/**
 * A view picked fades into the one shown: the page as it was (the list over
 * it too) fades out over the first half of `switch_ms` and the new view in
 * over the second, never both at once (two layouts over each other read as
 * a double image), once the new view has had `switch_wait_ms` to lay itself
 * out, so its first, unsettled frames are never seen. Without View Transitions in the browser, with
 * reduced motion asked for, or with `switch_ms` 0, the view changes at once.
 */
export interface Fade {
  /** How long the crossfade lasts, in ms; 0: none. */
  switch_ms?: number;
  /** How long the new view lays out under the old picture first, in ms. */
  switch_wait_ms?: number;
}

export const FADE_DEFAULTS: Required<Fade> = { switch_ms: 450, switch_wait_ms: 300 };

/** What starts a view transition: `document.startViewTransition`, bound. */
export type Start = (update: () => Promise<void>) => unknown;

/** The page's own starter, or none where the browser has none or reduced motion is asked for. */
export function pageStart(): Start | undefined {
  if (typeof document === "undefined") return undefined;
  const d = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };
  if (!d.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
  return (cb) => d.startViewTransition!(cb);
}

/** Runs `update` faded as `fade` says, through `start`; at once without one. True when it faded. */
export function faded(update: () => void, fade: Fade = {}, start: Start | undefined = pageStart(), wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): boolean {
  const ms = fade.switch_ms ?? FADE_DEFAULTS.switch_ms;
  if (!start || ms <= 0) {
    update();
    return false;
  }
  const root = typeof document !== "undefined" ? document.documentElement : undefined;
  root?.style.setProperty("--vw-switch", `${ms}ms`);
  // While it runs, every part of the page (a view's own named parts too) fades out, then in.
  root?.classList.add("vw-switch");
  const t = start(async () => {
    update();
    await wait(fade.switch_wait_ms ?? FADE_DEFAULTS.switch_wait_ms);
  }) as { finished?: Promise<unknown> } | undefined;
  const done = () => root?.classList.remove("vw-switch");
  if (t?.finished) t.finished.then(done, done);
  else done();
  return true;
}

/** The crossfade's timing, for the page's style sheet. */
export const FADE_STYLE = `
html.vw-switch::view-transition-group(*) { animation-duration:var(--vw-switch, .45s); }
html.vw-switch::view-transition-old(*) { animation:vw-old var(--vw-switch, .45s) ease-in both; }
html.vw-switch::view-transition-new(*) { animation:vw-new var(--vw-switch, .45s) ease-out both; }
@keyframes vw-old { 0% { opacity:1; } 50%, 100% { opacity:0; } }
@keyframes vw-new { 0%, 45% { opacity:0; } 100% { opacity:1; } }
`;
