// A change made from a stale read. An update may name the position of the fact stream it read the item at (as_of,
// which get answers): what it sets that anyone has set since, to another value, is refused with what moved, as a held
// change approved over a moved map is (./proposals.ts, overtakenFields). The agent reads it again and sends the op
// with the new position, through the retry a refused change has (packs/surface/kernel/tool-change.ts).

import type { Archipelago, Op, UpdateOp } from './pelago.ts';
import { overtakenFields } from './proposals.ts';

/** Each field an update sets that has moved since the position it says it read, said as what moved: none when none names one. */
export async function staleReads(l: Archipelago, ops: Op[]): Promise<string[]> {
  const problems: string[] = [];
  for (const [i, op] of ops.entries()) {
    if (op.op !== 'update' || typeof (op as UpdateOp).as_of !== 'number') continue;
    const asOf = (op as UpdateOp).as_of!;
    for (const moved of await overtakenFields(l, asOf, [op], `when you read it (as_of ${asOf})`))
      problems.push(`op ${i + 1} (update): moved since you read it: ${moved}. Read it again (get answers as_of) and send this op with the new as_of if it still should.`);
  }
  return problems;
}
