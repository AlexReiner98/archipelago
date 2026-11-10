// Launching an agent a server pack declares (task e_ukp2mqys, decision e_885ztqkv): the pack names its command
// (reach.server.launchers, argv with {prompt}, {mcp_config}, {tools}, {model}) and reads each line it prints (read); the
// server's launch setting names the pack that may launch. The kernel registers the run, mints the token the process
// is given (the pack never sees it), spawns with no shell and an empty environment, records what read answers, and
// on exit ends the run and revokes the token. Only a person launches.
//
// A seam for now: launching is the kernel's own (src/launcher.ts), as before.

import { configureLauncher } from './launcher.ts';

export type LaunchConfig = Parameters<typeof configureLauncher>[0];

/** Set up launching for this server: the setting's pack, once built; the kernel's own launcher until then. */
export function configureLaunch(config: LaunchConfig): void {
  configureLauncher(config);
}
