// A pack's actions and views as tools: each declared in its pack.json with a JSON Schema input, offered over MCP
// beside the kernel's own, and run by the pack's handler in its sandboxed process. An action's ops are applied as
// one change set naming it; a view writes nothing.

import { join } from 'node:path';
import { z } from 'zod';
import type { ActionDef } from './declared.ts';
import { PackHost, type Check } from './packhost.ts';
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
  /** check: asked of an action's ops before they are applied. */
  run(l: Archipelago, actor: Actor, input: unknown, check?: Check): Promise<unknown>;
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
    run: async (l, actor, input, check) =>
      call === 'action'
        ? hostFor(reg).act(l, actor, pack, def.id, input, def.limit_ms, 'action', check)
        : (await hostFor(reg).call(l, actor, pack, 'view', def.id, input, def.limit_ms)).answer ?? null,
  };
}

/**
 * The name of the pack action a short name stands for (software.test_report answers as test_report), when one loaded
 * pack declares it, so what other repositories call does not change as tools move into packs.
 */
export function packActionByShort(reg: Registry, name: string): string | undefined {
  const found = [...reg.tools].filter(([, t]) => t.call === 'action' && t.def.id.slice(t.def.id.indexOf('.') + 1) === name);
  return found.length === 1 ? found[0][0] : undefined;
}

/** Every tool the packs offer, by name. */
export function packTools(reg: Registry): [string, PackTool][] {
  return [...reg.tools.keys()].map((name) => [name, packTool(reg, name)!]);
}
