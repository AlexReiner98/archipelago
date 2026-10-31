// What a term of Find brought into a lens's answer, read off the answer alone (ui/query-light.js lights it).

/** The items a term of Find brought: those it found, and what the walk reached from them, a step at a time. */
export function litBy(answer, term) {
  const lit = new Set(answer.items.filter((i) => i.terms?.includes(term)).map((i) => i.id));
  const walked = answer.items.filter((i) => i.step).sort((a, b) => a.step - b.step);
  const step = new Map(answer.items.map((i) => [i.id, i.step ?? 0]));
  for (const item of walked) {
    const from = answer.links.some((l) => (l.from === item.id && lit.has(l.to) && step.get(l.to) < item.step) || (l.to === item.id && lit.has(l.from) && step.get(l.from) < item.step));
    if (from) lit.add(item.id);
  }
  return lit;
}

/** Whether a term of Only or Not would change what is drawn: it leaves out something, and not everything. */
export const changes = (left, drawn) => left > 0 && left < drawn;
