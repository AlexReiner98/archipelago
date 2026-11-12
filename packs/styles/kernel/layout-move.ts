// A layout is its own type (decision e_nv3rfcge): a style with code, or the owner's version of a pack's drawing, is
// a layout now. A migration, run when a workspace opens, after the styles made for one view have moved into it
// (packs/styles/kernel/style-move.ts): one change set the system appends, so the log keeps what each style said and is never
// rewritten. A view that named one by its id names it still.

import type { KernelContext } from '#pelago/kernel';

type Props = Record<string, unknown>;

/** A fact of the log (packs/log/kernel/log.ts, Fact): a field set, or taken off. */
export type Fact = ['+', string, string, unknown] | ['-', string, string];

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

/** Why the move is made, as the log keeps it. */
export const LAYOUTS_MOVED = 'A layout is its own type: each style with code, or a version of a pack drawing, is a layout now';

/**
 * The migration, planned: the facts that make each such style a layout, and the styles that become layouts. What it
 * reads is the styles pack's read (layout_moves).
 */
export async function planLayouts(ctx: KernelContext): Promise<{ facts: Fact[]; layouts: string[] }> {
  if (!ctx.registry.types.has('layout')) return { facts: [], layouts: [] };
  const drawings = new Set(ctx.registry.packs.flatMap((p) => (p.layouts ?? []).map((d) => d.id)));
  const rows = (await ctx.reads({ layout_moves: [...drawings] })) as { id: string; props: Props }[];
  const facts = layoutsMoved(rows, drawings);
  return { facts, layouts: facts.length ? rows.filter((r) => isLayout(r.props, drawings)).map((r) => r.id) : [] };
}

/** The migration: the planned facts appended as the system's move (ctx.move); the styles that became layouts. */
export async function moveLayouts(ctx: KernelContext): Promise<string[]> {
  const { facts, layouts } = await planLayouts(ctx);
  if (!facts.length) return [];
  await ctx.move('layout.moved', LAYOUTS_MOVED, facts);
  return layouts;
}
