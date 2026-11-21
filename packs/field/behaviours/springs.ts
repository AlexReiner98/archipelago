/**
 * Springs: each link a spring of its own length and stiffness, by its
 * type, so what is part of a thing sits close to it. A stiffness of 0
 * leaves that type out of the structure: still drawn, pulling nothing.
 * A hub's springs are each weaker, so its many links don't pull it apart.
 */
import { weight, type Behaviour } from "../behaviour.ts";

/** Where each link type starts; a type not named here starts as `other`. */
const START: Record<string, [number, number]> = {
  part_of: [14, 0.5],
  depends_on: [34, 0.25],
  waits_on: [40, 0.1],
  bears_on: [50, 0.05],
  about: [50, 0.05],
};
const OTHER: [number, number] = [50, 0.05];

export const lengthKey = (type: string) => `spring_${type}_length`;
export const stiffKey = (type: string) => `spring_${type}_k`;

const springs: Behaviour = {
  name: "springs",
  doc: "Each link pulls its ends to its type's length.",
  on: true,
  dials: ({ links }) => [
    weight("springs"),
    { key: "springs_hub", label: "hubs give", min: 0, max: 1, step: 0.05, value: 1, doc: "How much a hub's springs weaken with its links (1: each divided by the smaller degree; 0: none weaker)." },
    ...links.flatMap((type) => {
      const [len, k] = START[type] ?? OTHER;
      return [
        { key: lengthKey(type), label: `${type} length`, min: 2, max: 200, step: 1, value: len, doc: `How long a ${type} link wants to be.` },
        { key: stiffKey(type), label: `${type} stiffness`, min: 0, max: 1, step: 0.01, value: k, doc: `How hard a ${type} link pulls to its length (0: it pulls nothing).` },
      ];
    }),
  ],
  apply(g, f, S) {
    const len = g.linkKinds.map((t) => S[lengthKey(t)] ?? OTHER[0]);
    const stiff = g.linkKinds.map((t) => S[stiffKey(t)] ?? OTHER[1]);
    const hub = S.springs_hub!;
    for (let e = 0; e < g.m; e++) {
      const kind = g.kind[e]!, k = stiff[kind]!;
      if (!k) continue;
      const a = g.a[e]!, b = g.b[e]!;
      const dx = g.x[b]! - g.x[a]!, dy = g.y[b]! - g.y[a]!, dz = g.z[b]! - g.z[a]!;
      const d = Math.hypot(dx, dy, dz) || 1e-6;
      const da = g.degree[a]!, db = g.degree[b]!;
      const pull = (k * (d - len[kind]!)) / d / Math.pow(Math.min(da, db), hub);
      const share = da / (da + db);
      f.x[a]! += dx * pull * (1 - share);
      f.y[a]! += dy * pull * (1 - share);
      f.z[a]! += dz * pull * (1 - share);
      f.x[b]! -= dx * pull * share;
      f.y[b]! -= dy * pull * share;
      f.z[b]! -= dz * pull * share;
    }
  },
};

export default springs;
