/**
 * How far the camera closes the gap to the fitted view in one frame. It
 * eases out by closing a share of what is left (`ms`, about two thirds of
 * the way in that time). After a jump to what the find line keeps, it also
 * eases in from rest over `ms`, so the map never lurches on the first frame.
 */
export function followShare(dt: number, ms: number, sinceJump?: number): number {
  if (ms <= 0) return 1;
  const out = 1 - Math.exp(-dt / ms);
  if (sinceJump === undefined) return out;
  const k = Math.max(0, Math.min(1, sinceJump / ms));
  return out * k * k * (3 - 2 * k);
}
