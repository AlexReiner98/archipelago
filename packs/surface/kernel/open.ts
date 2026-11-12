// What the surface root runs in a workspace while this server leads (src/lifecycle.ts): the packs' schedules, the
// hook host's. Loading this module also loads the reads API.

import type { RootLeading } from '../../identity/kernel/lifecycle.ts';
import { startSchedules, stopSchedules } from './hooks.ts';
// The reads API fills the loader's slot loader.reads as it loads: a workspace's packs read the map through it from the
// types phase on (src/packhost.ts), so it is loaded before any workspace opens.
import './packreads.ts';

export const LEADING: RootLeading = [
  (ws) => {
    startSchedules(ws.pelago);
    return () => stopSchedules(ws.pelago.registry);
  },
];
