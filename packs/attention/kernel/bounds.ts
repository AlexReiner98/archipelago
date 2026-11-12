// Bounds: a field against a limit, declared by a type as its bound capability. A date due by a day, a quantity
// under its reorder level. What crosses one is at risk, whatever the field is called. The crossing is read as the
// database reckons dates and numbers (the read bounds, src/packreads-kernel.ts), so a day ends where the map's does.
import type { KernelContext } from '#pelago/kernel';

interface Crossed {
  id: string;
  type: string;
  title: string;
  status: string;
  owner: string | null;
}

/** Open items among some whose bound is crossed or near: a date due within some days, or a quantity under its limit. */
export async function pastBounds(ctx: KernelContext, days: number, among: string[]) {
  return (await ctx.reads({ bounds: { ids: among, days } })) as { due: (Crossed & { due: string; overdue: boolean })[]; under: (Crossed & { value: number; limit: number })[] };
}
