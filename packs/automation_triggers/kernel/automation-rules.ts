// What makes an automation's definition complete: when it comes due (a time of day, daily or on its days, or a
// query starting to match) and what it does (notify or launch); the automations pack does it. Kept free of runtime imports so the
// write path can check a definition before it is stored. What a watched query's edge meets is ./edges.ts.

export * from './edges.ts';

/** What a check asks of the types: whether one is an automation, by the registry the change is judged by. */
export interface Types { isA(type: string, of: string): boolean }

/** The days of the week, 1 for Monday to 7 for Sunday, as the time pack counts them. */
const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** A weekly automation's days as numbers, 1 (Monday) to 7: each given as a number or a name ("monday", "mon"). Undefined if any is neither. */
export function weekdays(given: unknown): number[] | undefined {
  const list = Array.isArray(given) ? given : [given];
  const days = list.map((d) => (typeof d === 'number' ? d : typeof d === 'string' && d.trim().length >= 3 ? DAY_NAMES.findIndex((n) => n.startsWith(d.trim().toLowerCase())) + 1 : 0));
  return list.length && days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) ? days : undefined;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Problems with what an automation is to do, when the type written is one. */
export function checkWritten(reg: Types, type: string, props: Record<string, unknown>): string[] {
  return reg.isA(type, 'automation') ? checkAutomation(props) : [];
}

/** Problems with a change to an automation: the `on` it is given, checked whole, as on a create. */
export function checkUpdated(reg: Types, type: string, props: Record<string, unknown>): string[] {
  return reg.isA(type, 'automation') && props.on !== undefined && props.on !== null ? checkOn(props.on) : [];
}

/** What an automation that watches a query fires on: a flat filter (as `query` name `flat` takes it) and its edge. */
export interface On {
  query: { filter: { find: string[]; only?: string[]; not?: string[] }; walk?: unknown; limit?: number };
  edge: string;
  /** For crosses: the field whose value crosses n. */
  field?: string;
}

/** An edge read: first (the query matches at all), each (each item that starts to match), first_per (each value of a field met), crosses (an item's field reaching n from under it). */
export type Edge = { kind: 'first' } | { kind: 'each' } | { kind: 'first_per'; field: string } | { kind: 'crosses'; n: number; field: string };

/** The most items a watched query may read at once. */
export const ON_LIMIT = 500;

const FIELD = /^[a-z_][a-z0-9_]*$/;

/** The edge of a checked `on`. */
export function edgeOf(on: On): Edge {
  if (on.edge === 'first' || on.edge === 'each') return { kind: on.edge };
  if (on.edge.startsWith('first_per:')) return { kind: 'first_per', field: on.edge.slice('first_per:'.length) };
  return { kind: 'crosses', n: Number(on.edge.slice('crosses:'.length)), field: on.field! };
}

/** Problems with what an automation watches: a query that finds something, bounded, and an edge it can meet. */
export function checkOn(on: unknown): string[] {
  const problems: string[] = [];
  if (!on || typeof on !== 'object' || Array.isArray(on)) return ['on must be { query, edge }: a flat filter and when it fires'];
  const o = on as Record<string, unknown>;
  const q = o.query as Record<string, unknown> | undefined;
  const filter = q && typeof q === 'object' ? (q.filter as Record<string, unknown> | undefined) : undefined;
  const terms = (v: unknown) => Array.isArray(v) && v.every((t) => typeof t === 'string' && t.trim());
  if (!filter || typeof filter !== 'object' || !terms(filter.find) || !(filter.find as string[]).length) problems.push('on.query needs filter.find: a list of terms that finds something, as query name flat takes it');
  else for (const part of ['only', 'not'] as const) if (filter[part] !== undefined && !terms(filter[part])) problems.push(`on.query.filter.${part} must be a list of terms`);
  if (q && q.limit !== undefined && (!Number.isInteger(q.limit) || (q.limit as number) < 1 || (q.limit as number) > ON_LIMIT)) problems.push(`on.query.limit must be a whole number from 1 to ${ON_LIMIT}`);
  if (q && q.time !== undefined) problems.push('on.query cannot name a window of time: when is the edge, not the query');
  const edge = o.edge;
  if (typeof edge !== 'string') problems.push('on.edge must be first, each, first_per:<field> or crosses:<n>');
  else if (edge.startsWith('first_per:')) {
    if (!FIELD.test(edge.slice('first_per:'.length))) problems.push('on.edge first_per needs a field name after the colon, e.g. first_per:region');
  } else if (edge.startsWith('crosses:')) {
    const n = edge.slice('crosses:'.length);
    if (!n.trim() || !Number.isFinite(Number(n))) problems.push('on.edge crosses needs a number after the colon, e.g. crosses:10000');
    if (typeof o.field !== 'string' || !FIELD.test(o.field)) problems.push('on.edge crosses needs on.field: the field whose value crosses n');
  } else if (edge !== 'first' && edge !== 'each') problems.push('on.edge must be first, each, first_per:<field> or crosses:<n>');
  return problems;
}

export function checkAutomation(props: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (props.on !== undefined) problems.push(...checkOn(props.on));
  // One that watches a query comes due on its edge: it needs no time beside it.
  if (props.on === undefined || props.trigger !== undefined)
    switch (props.trigger) {
      case 'daily':
        if (typeof props.at !== 'string' || !TIME.test(props.at)) problems.push('trigger "daily" needs at as "HH:MM" (24-hour, in the workspace time zone)');
        break;
      case 'weekly':
        if (!weekdays(props.days)) problems.push('trigger "weekly" needs days: the days of the week, as names ("monday") or numbers (1 for Monday to 7)');
        if (typeof props.at !== 'string' || !TIME.test(props.at)) problems.push('trigger "weekly" needs at as "HH:MM" (24-hour, in the workspace time zone)');
        break;
      default:
        problems.push('an automation needs trigger daily or weekly, or on: a query and the edge it fires on');
    }
  const input = (props.input ?? {}) as Record<string, unknown>;
  switch (props.action) {
    case 'notify':
      break;
    case 'launch':
      if (typeof input.task !== 'string') problems.push('action "launch" needs input.task: the id of the entity to work on');
      if (input.mode !== undefined && input.mode !== 'plan' && input.mode !== 'acceptEdits') problems.push('input.mode must be plan or acceptEdits');
      break;
    default:
      problems.push('an automation needs action: notify or launch');
  }
  return problems;
}

/** answer.automation_problems: what is wrong with an automation's definition, as the loader asks before a pack launches one (src/pack-launch.ts). */
export const problemsOf = (_ctx: unknown, input: { props?: Record<string, unknown> }) => ({ problems: checkAutomation(input?.props ?? {}) });
