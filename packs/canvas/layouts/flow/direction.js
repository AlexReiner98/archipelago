// Which way each link runs down the page, firmest first. Layer: graph. Pure: links in, ways out.

/**
 * Which way each joined two run down the page, as `${upper} ${lower}` to how firmly: the order first (3), what is depended
 * on above what depends on it; then every headed link (2), its head pointing down; then a link with no head (1), what
 * holds above what is held. A link that would close a ring against firmer ones has no way.
 */
export function directions(chains, ties, headless) {
  const after = new Map(), found = new Map();
  const reaches = (a, b) => {
    const seen = new Set([a]), todo = [a];
    while (todo.length) for (const w of after.get(todo.pop()) ?? []) {
      if (w === b) return true;
      if (!seen.has(w)) (seen.add(w), todo.push(w));
    }
    return false;
  };
  const lead = (a, b, firm) => {
    if (a === b || found.has(`${a} ${b}`) || found.has(`${b} ${a}`) || reaches(b, a)) return;
    found.set(`${a} ${b}`, firm);
    (after.get(a) ?? after.set(a, []).get(a)).push(b);
  };
  for (const c of chains) lead(c.a, c.b, 3);
  for (const t of ties) if (!headless.includes(t.type)) lead(t.a, t.b, 2);
  for (const t of ties) if (headless.includes(t.type)) lead(t.b, t.a, 1);
  return found;
}
