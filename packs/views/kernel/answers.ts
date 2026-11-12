// The answers this pack provides (pack.json, kernel.provides): what a lens preset that names graph, tree or brief is
// answered with. Each is handed the view's params, with its lens and its choices as the preset declares them
// (src/query-presets.ts, answerPreset), and a context of the map that asks.

import type { KernelContext } from '#pelago/kernel';
import { brief as briefOf, briefRead } from './brief.ts';
import { graph as graphOf, type GraphDef } from './view-graph.ts';
import { tree as treeOf } from './view-tree.ts';

type Asked = Record<string, unknown> & { lens?: Record<string, unknown>; choices?: GraphDef['choices'] };

/** answer.graph: nodes and edges for drawing the map (view-graph.ts). */
export const graph = (ctx: KernelContext, { lens: _lens, choices, ...params }: Asked) => graphOf(ctx, { choices }, params);

/** answer.tree: a tree a pack declares over what is part of what (view-tree.ts). */
export const tree = (ctx: KernelContext, { lens: _lens, choices: _choices, ...params }: Asked) => treeOf(ctx, params);

/** answer.brief: everything a session needs to start on a task, read around it by the links the preset names (brief.ts). */
export async function brief(ctx: KernelContext, params: Asked) {
  if (!params.task) throw new Error('brief needs "task": the id of the entity to work on');
  const read = await briefRead(ctx, String(params.task), (params.lens?.over as string[] | undefined) ?? []);
  return briefOf(ctx, { task: String(params.task) }, read);
}
