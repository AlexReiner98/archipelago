// The filling of write.validate (docs/kernel-packs.md, "Write-path hooks"): an automation's trigger and conditions,
// checked as written (./automation-rules.ts), by the types of the version its island runs. Moved out of the write
// path's own fillings (src/write-fillings.ts), counting the same.

import type { KernelContext } from '#pelago/kernel';
import { checkUpdated, checkWritten, type Types } from './automation-rules.ts';
import { acting } from './due-on.ts';

type Props = Record<string, unknown>;
type Op = { op: string; id?: string; type?: string; props?: Props };

/** The registry an island runs, as the write path hands it (src/write-hooks.ts, Judged): read only for its types. */
interface Judged { islandRegistry(island: unknown): Promise<Types & { type(id: string): unknown }> }

/** Each automation written in these ops whose trigger or conditions are wrong, as refusals naming the op; none where the automations pack is off. */
export async function validate(ctx: KernelContext, ops: Op[], _who: unknown, judged: Judged): Promise<{ refusals: string[] }> {
  const refusals: string[] = [];
  if (!acting(ctx)) return { refusals }; // a map without the automations pack: nothing here checks what it would do
  for (const [i, op] of ops.entries()) {
    const where = `op ${i + 1} (${op.op})`;
    if (op.op === 'create') {
      const here = await judged.islandRegistry(op.props?.island);
      if (here.type(op.type as string)) refusals.push(...checkWritten(here, op.type as string, op.props ?? {}).map((p) => `${where}: ${p}`));
    } else if (op.op === 'update' && op.props?.on !== undefined && op.props.on !== null) {
      const [target] = (await ctx.reads({ ids: [op.id as string] })) as { type: string; props?: Props }[];
      if (!target) continue;
      const here = await judged.islandRegistry(op.props.island ?? target.props?.island);
      refusals.push(...checkUpdated(here, target.type, op.props).map((p) => `${where}: ${p}`));
    }
  }
  return { refusals };
}
