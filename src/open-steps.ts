// What service packs do at a workspace's open and while this server leads, held by the kernel until each step moves its
// module into its pack (src/lifecycle.ts): a root's own steps are the root's (its kernel/open.ts), and what an internal
// pack's manifest fills runs with its context. Each line here leaves with its module: the first island with
// island-start (placement), the look for quiet sessions with session-quiet (sessions). The clock's code is the clocks
// pack's (packs/clocks/kernel/due.ts); its timer stays here only for what a failed pass does, telling the owner
// (src/alert.ts), until the alerts pack answers that by a service name: it then becomes the pack's kernel.timers.

import { alertOwner } from './alert.ts';
import { duePass, EVERY_MS } from './due.ts';
import { firstIsland } from './island-start.ts';
import { onOpen, timer, whileLeading } from './lifecycle.ts';
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

// The clock, a timer of the clocks pack: run in each workspace while this server leads (src/leader.ts), a failed pass
// told to the workspace's owner.
timer('clocks', EVERY_MS, (ws) => duePass(ws.pelago), {
  failed: (ws, err) => void alertOwner(ws.pelago, { key: 'clock', title: 'The clock failed', body: `A pass over what came due failed: ${err.message}`, from: 'pelago' }),
});
