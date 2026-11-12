// What service packs do at a workspace's open and while this server leads, held by the kernel until each step moves its
// module into its pack (src/lifecycle.ts): a root's own steps are the root's (its kernel/open.ts), and what an internal
// pack's manifest fills runs with its context. Each line here leaves with its module: the first island with
// island-start (placement), the look for quiet sessions with session-quiet (sessions). The clock left: it is the clocks
// pack's kernel.timers, a failed pass told to the owner by the alerts pack's name (act.report.alert).

import { firstIsland } from './island-start.ts';
import { onOpen, whileLeading } from './lifecycle.ts';
import { setIslands } from './packstate.ts';

// islands: a fresh default map on islands, as create puts every other new map (e_44rbfwxp).
onOpen('islands', 'placement', async (o) => {
  if (!(o.begins && o.isDefault && o.config.defaultOnIslands)) return;
  await setIslands(o.pelago!, 'system', true);
  await firstIsland(o.pelago!, o.name);
});

// While this server leads: the look for sessions gone quiet.
whileLeading('sessions', (ws) => {
  ws.quiet.start();
  return () => ws.quiet.stop();
});

