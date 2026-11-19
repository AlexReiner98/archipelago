// The rules root pack (docs/kernel-packs.md, "The root packs", 7): who decides what applies. `decide` and `judge` read
// every pack's rules as data; authority, private deps and layout changes say who may do what.
// It opens the slot rules.<on> (the loader's rule-events.ts), which the pack deciding about an event fills from its manifest
// (sessions: kernel.hooks["rules.reply_ended"]). While the wave lasts every other module still reaches its code through the shims in src/, so start
// loads nothing at boot that the server did not load before: it answers its parts, each loaded when first asked for.

import type { RootContext, RootStarted } from '../../../src/boot.ts';
import { setFloor } from '../../loader/kernel/pack-source.ts';
import { FLOOR_PACKS, onFloor } from './floor.ts';

export function start(_ctx: RootContext): RootStarted {
  setFloor({ packs: FLOOR_PACKS, on: onFloor }); // the floor rules a map's pack items cannot drop (./floor.ts)
  return {
    rules: () => import('./rules.ts'),
    events: () => import('../../loader/kernel/rule-events.ts'), // the loader reads the slot's fillings from the manifests
  };
}
