/**
 * Aspect: the picture takes the panel's shape. It asks for the spread of the
 * particles across to stand to their spread up and down as the panel's
 * width to its height: its energy is how far the two ratios are apart (the
 * square of the log of one over the other) times how spread the picture is,
 * so it stretches or squeezes a picture of any size about as hard as gather
 * holds it, and is at rest once the shapes match. A wide strip is filled end to end,
 * a tall one top to bottom. `aspect_ratio` fixes the shape instead of
 * following the panel.
 *
 * The panel's ratio is `g.view.aspect`, which the engine keeps as the
 * canvas is resized; without it (a test, a worker), it asks for round.
 */
import { weight, type Behaviour } from "../behaviour.ts";
import type { G, Settings } from "../graph.ts";

/** The spreads about the middle, and how far their ratio is from the one wanted (as a log). */
const shape = (g: G, S: Settings) => {
  const r = Math.max(0.05, S.aspect_ratio! > 0 ? S.aspect_ratio! : (g.view?.aspect ?? 1));
  let mx = 0, my = 0;
  for (let i = 0; i < g.n; i++) (mx += g.x[i]!), (my += g.y[i]!);
  mx /= Math.max(1, g.n);
  my /= Math.max(1, g.n);
  let vx = 0, vy = 0;
  for (let i = 0; i < g.n; i++) (vx += (g.x[i]! - mx) ** 2), (vy += (g.y[i]! - my) ** 2);
  const ok = g.n > 1 && vx > 1e-9 && vy > 1e-9;
  return { mx, my, vx, vy, off: ok ? Math.log(vx / vy) - 2 * Math.log(r) : 0, ok };
};

const aspect: Behaviour = {
  name: "aspect",
  doc: "The picture takes the shape of its panel: wide in a wide one, tall in a tall one.",
  // Off unless a view asks for it (on_aspect): a strip under something else, say; the Landscape stays round.
  on: false,
  dials: () => [
    weight("aspect"),
    { key: "aspect_k", label: "pull", min: 0, max: 0.05, step: 0.0005, value: 0.004, doc: "How hard the picture is stretched or squeezed toward the panel's shape, for how far its own shape is from it." },
    { key: "aspect_ratio", label: "ratio", min: 0, max: 6, step: 0.05, value: 0, doc: "The shape to settle into, width over height. 0: the panel's own, followed as it is resized." },
  ],
  // Half the pull times the square of how far the shapes are apart (as the log of their ratio), times the spread.
  energy(g, S) {
    const s = shape(g, S);
    return s.ok ? (S.aspect_k! * s.off ** 2 * (s.vx + s.vy)) / 2 : 0;
  },
  // Its slope: across, out from the middle while the picture is too narrow, in while it is too wide; up and down the
  // other way; and a pull to the middle that fades as the shapes come to match.
  apply(g, f, S) {
    const s = shape(g, S);
    if (!s.ok) return;
    const k = S.aspect_k!, t = s.vx + s.vy;
    const ax = k * (2 * s.off * (t / s.vx) + s.off ** 2);
    const ay = k * (-2 * s.off * (t / s.vy) + s.off ** 2);
    for (let i = 0; i < g.n; i++) {
      f.x[i]! -= ax * (g.x[i]! - s.mx);
      f.y[i]! -= ay * (g.y[i]! - s.my);
    }
  },
};

export default aspect;
