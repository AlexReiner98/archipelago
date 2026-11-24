/**
 * A view picked fades into the one shown through the page's own ground: a
 * cover of the background colour fades in over half of `switch_ms`, the view
 * changes under it and has `switch_wait_ms` to lay itself out, and the cover
 * fades away over the other half. The old view and the new are never drawn
 * over each other, and the new one's first, unsettled frames are never seen.
 * With reduced motion asked for, or `switch_ms` 0, the view changes at once.
 */
export interface Fade {
  /** How long the fade out and back in lasts, in ms; 0: none. */
  switch_ms?: number;
  /** How long the new view lays out under the cover, in ms. */
  switch_wait_ms?: number;
}

export const FADE_DEFAULTS: Required<Fade> = { switch_ms: 450, switch_wait_ms: 100 };

/** What hides the page while a view changes: shown and hidden over `ms`, then done with. */
export interface Cover {
  show(ms: number): void;
  hide(ms: number): void;
  done(): void;
}

/** A cover of the page's background over everything; none where reduced motion is asked for. */
export function pageCover(): Cover | undefined {
  if (typeof document === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
  const el = document.createElement("div");
  el.className = "vw-cover";
  document.body.append(el);
  const to = (opacity: number, ms: number) => {
    // Its start drawn first, so the change is seen as a fade.
    void el.getBoundingClientRect();
    el.style.transitionDuration = `${ms}ms`;
    el.style.opacity = String(opacity);
  };
  return { show: (ms) => to(1, ms), hide: (ms) => to(0, ms), done: () => el.remove() };
}

/** Runs `update` under a fade as `fade` says; at once without a cover. True when it fades. */
export function faded(update: () => void, fade: Fade = {}, cover: Cover | undefined = pageCover(), wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): boolean {
  const ms = fade.switch_ms ?? FADE_DEFAULTS.switch_ms;
  if (!cover || ms <= 0) {
    cover?.done();
    update();
    return false;
  }
  const half = ms / 2;
  void (async () => {
    cover.show(half);
    await wait(half);
    update();
    await wait(fade.switch_wait_ms ?? FADE_DEFAULTS.switch_wait_ms);
    cover.hide(half);
    await wait(half);
    cover.done();
  })();
  return true;
}

/** The cover's look, for the page's style sheet. */
export const FADE_STYLE = `
.vw-cover { position:fixed; inset:0; z-index:2147483000; pointer-events:none; background:var(--bg); opacity:0; transition-property:opacity; transition-timing-function:ease-in-out; }
`;
