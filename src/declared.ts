// What a pack offers agents and people: actions (its verbs, each specialising one of the kernel's six) and views
// (reads that write nothing), declared in its pack.json with JSON Schema inputs and run by its handler. The six
// verbs are declared by the core pack the same way. Checked when the pack loads.

import type { PackFile, ResolvedType } from './packs.ts';

export interface VerbDef {
  id: string;
  title: string;
  description: string;
}

export interface ActionDef {
  id: string;
  title: string;
  /** What agents are told the tool does. */
  description: string;
  /** The kernel verb it specialises: what it made reads as that verb made it when the pack is gone. */
  verb: string;
  /** The kinds or types it acts on, which decides whose page shows its form. */
  on?: string[];
  /** JSON Schema of an object. */
  input: Record<string, unknown>;
  /** How long a call may take, in milliseconds: 2000 unless said, 30000 at most. */
  limit_ms?: number;
}

export interface ViewDef {
  id: string;
  description: string;
  input: Record<string, unknown>;
  /** rows: one-line rows the kernel draws, each with an item; data: for agents only. */
  shape: 'rows' | 'data';
  limit_ms?: number;
}

/**
 * The kernel's own tools that are one of the six verbs in all but name. change, the generic op, stays beneath them
 * all, as do the tools that only read.
 */
export const KERNEL_VERBS: Record<string, string> = {
  confirmed: 'settle',
  decide: 'settle',
  rechecked: 'report',
  session_end: 'report',
  session_update: 'report',
  tell: 'report',
  run_report: 'report',
  test_report: 'report',
  notify: 'ask',
  claim: 'assign',
  launch: 'assign',
  release: 'revise',
  undo: 'revise',
};

/** What an action or view is called as a tool: time.log is time_log. */
export const toolName = (id: string) => id.replaceAll('.', '_');

const isObjectSchema = (s: unknown) => Boolean(s) && typeof s === 'object' && (s as { type?: unknown }).type === 'object';

/** Problems with what a pack declares, given the types loaded and whether it has a handler. Empty means it loads. */
export function checkDeclared(pack: PackFile, types: Map<string, ResolvedType>, verbs: string[], handler: boolean): string[] {
  const problems: string[] = [];
  const own = (id: string) => pack.id === 'core' || id.startsWith(pack.id + '.');
  const seen = new Set<string>();
  for (const [what, list] of [['action', pack.actions ?? []], ['view', pack.views ?? []]] as const) {
    for (const def of list) {
      const at = `${what} "${def.id}"`;
      if (!own(def.id)) problems.push(`${at} must be named "${pack.id}.<name>"`);
      if (seen.has(def.id)) problems.push(`${at} is declared twice`);
      seen.add(def.id);
      if (!handler) problems.push(`${at} needs the pack's handler.js: a verb with nothing to compute is a generic op`);
      if (!isObjectSchema(def.input)) problems.push(`${at}: input is the JSON Schema of an object`);
      if (def.limit_ms !== undefined && !(def.limit_ms > 0 && def.limit_ms <= 30_000)) problems.push(`${at}: limit_ms is at most 30000`);
      if (what === 'action') {
        const action = def as ActionDef;
        if (!verbs.includes(action.verb)) problems.push(`${at} specialises "${action.verb}", which is not a verb: one of ${verbs.join(', ')}`);
        for (const t of action.on ?? []) if (!types.has(t)) problems.push(`${at} acts on unknown type "${t}"`);
      } else if (!['rows', 'data'].includes((def as ViewDef).shape)) problems.push(`${at}: shape is rows or data`);
    }
  }
  return problems;
}
