// A layout is its own type (decision e_nv3rfcge): a style with code, or the owner's version of a pack's drawing, is
// a layout now. A migration, run when a workspace opens, after the styles made for one view have moved into it
// (src/style-move.ts): one change set the system appends, so the log keeps what each style said and is never
// rewritten. A view that named one by its id names it still.

import type { Fact } from './log.ts';
import type { Archipelago } from './pelago.ts';

type Props = Record<string, unknown>;

/** What a layout keeps as its own; every other field a style held goes into its settings. */
const OWN = ['code', 'modules', 'writes', 'preset'];

/** Whether a style is a layout: it has code, or modules, or is the owner's version of a pack's drawing. */
export const isLayout = (props: Props, drawings: Set<string>) =>
  typeof props.code === 'string' || (props.modules != null && typeof props.modules === 'object') || (typeof props.preset === 'string' && drawings.has(props.preset));

/** The facts that make each such style a layout: its type, and its other fields put in its settings. Pure. */
export function layoutsMoved(styles: { id: string; props: Props }[], drawings: Set<string>, layout = 'layout'): Fact[] {
  const facts: Fact[] = [];
  for (const { id, props } of styles) {
    if (!isLayout(props, drawings)) continue;
    facts.push(['+', id, 'type', layout]);
    const rest = Object.entries(props).filter(([key, value]) => !OWN.includes(key) && key !== 'settings' && value != null);
    const settings = { ...(props.settings && typeof props.settings === 'object' && !Array.isArray(props.settings) ? (props.settings as Props) : {}), ...Object.fromEntries(rest) };
    if (Object.keys(settings).length) facts.push(['+', id, 'settings', settings]);
    for (const [key] of rest) facts.push(['-', id, key]);
  }
  return facts;
}

/** The migration: returns the styles that became layouts. */
export async function moveLayouts(l: Archipelago): Promise<string[]> {
  if (!l.registry.types.has('layout')) return [];
  const drawings = new Set(l.registry.packs.flatMap((p) => (p.layouts ?? []).map((d) => d.id)));
  const { rows } = await l.db.query<{ id: string; props: Props }>(
    `select id, props from entity where type = any($1::text[]) and (props ? 'code' or props ? 'modules' or props ->> 'preset' = any($2::text[])) order by updated_at, id -- index entity_type`,
    [l.registry.family('style'), [...drawings]],
  );
  const facts = layoutsMoved(rows, drawings);
  if (!facts.length) return [];
  await l.db.transaction((tx) => l.moved(tx, 'layout.moved', 'A layout is its own type: each style with code, or a version of a pack drawing, is a layout now', facts));
  return rows.filter((r) => isLayout(r.props, drawings)).map((r) => r.id);
}
