// surface.tools: the tools this pack declares to the surface (packs/surface/kernel/tools.ts), each its input a JSON
// shape and run on this pack's context of the map it is called on: those that share and publish (./share-tools.ts).

import { SHARE_TOOLS } from './share-tools.ts';

export const tools = () => SHARE_TOOLS;
