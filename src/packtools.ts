// A pack's actions and views as tools: each declared in its pack.json with a JSON Schema input, offered over MCP
// beside the kernel's own, and run by the pack's handler in its sandboxed process. An action's ops are applied as
// one change set naming it; a view writes nothing.

import { join } from 'node:path';
import { z } from 'zod';
import type { ActionDef } from './declared.ts';
import { PackHost } from './packhost.ts';
import type { Registry } from './packs.ts';
import type { Actor, Archipelago } from './pelago.ts';

/** The pack processes of each workspace, by its registry. */
const hosts = new WeakMap<Registry, PackHost>();

export function hostFor(reg: Registry): PackHost {
  let host = hosts.get(reg);
  if (!host) hosts.set(reg, (host = new PackHost((pack) => (pack === 'local' && reg.localDir ? reg.localDir : join(reg.dir, pack)))));
  return host;
}

/** A tool as the MCP server and callTool need it. */
export interface PackTool {
  description: string;
  input: z.ZodRawShape;
  /** A view only reads, so a token limited to reading may call it. */
  reads: boolean;
  run(l: Archipelago, actor: Actor, input: unknown): Promise<unknown>;
}

/** The tool a pack offers under this name, if one does. */
export function packTool(reg: Registry, name: string): PackTool | undefined {
  const found = reg.tools.get(name);
  if (!found) return undefined;
  const { pack, call, def } = found;
  const schema = z.fromJSONSchema(def.input as Parameters<typeof z.fromJSONSchema>[0]) as unknown as z.ZodObject;
  const verb = call === 'action' ? ` (${(def as ActionDef).verb}, from the ${pack} pack)` : ` (a read, from the ${pack} pack)`;
  return {
    description: def.description + verb,
    input: schema.shape ?? {},
    reads: call === 'view',
    run: async (l, actor, input) =>
      call === 'action'
        ? hostFor(reg).act(l, actor, pack, def.id, input, def.limit_ms)
        : (await hostFor(reg).call(l, actor, pack, 'view', def.id, input, def.limit_ms)).answer ?? null,
  };
}

/** Every tool the packs offer, by name. */
export function packTools(reg: Registry): [string, PackTool][] {
  return [...reg.tools.keys()].map((name) => [name, packTool(reg, name)!]);
}
