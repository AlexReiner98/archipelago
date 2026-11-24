/**
 * Which fill the center shows: the one `here.view` names; else the first, unless the frame waits for a first
 * pick (its config's `wait`, while no view has been picked yet). Waiting, it shows nothing, so a page that a
 * picker opens on one view (the views pack, from the URL) never paints another view first.
 */
export function centerShown<F>(fills: readonly F[], key: (f: F) => string, view: string | undefined, waiting: boolean): F | undefined {
  const named = fills.find((f) => key(f) === view);
  if (named) return named;
  return waiting ? undefined : fills[0];
}
