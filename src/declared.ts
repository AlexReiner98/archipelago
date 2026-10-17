// What a pack offers agents and people: actions (its verbs, each specialising one of the kernel's six) and views
// (reads that write nothing), declared in its pack.json with JSON Schema inputs and run by its handler. The six
// verbs are declared by the core pack the same way. Checked when the pack loads.

import { REASONS } from './attention.ts';
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
  /** The input the item's id goes in, when its form is opened from an item's page. */
  item?: string;
  /** JSON Schema of an object. */
  input: Record<string, unknown>;
  /** How long a call may take, in milliseconds: 2000 unless said, 30000 at most. */
  limit_ms?: number;
  /** What it may ask to be done outside the map. A request to act that is not declared here is refused. */
  acts?: ActDef[];
}

/** A service outside the map a pack may reach, and the name of the secret the kernel adds (the pack never sees it). */
export interface HostDef {
  id: string;
  base: string;
  secret?: string;
  /** The header the secret goes in: authorization (as a bearer token) unless said. */
  header?: string;
}

/** Something an action may have done outside the map. One that moves money or cannot be taken back waits for a person. */
export interface ActDef {
  id: string;
  host: string;
  does: string;
  money?: boolean;
  final?: boolean;
}

/** A route the kernel serves at /hook/<pack>/<id>, checking the payload's signature with a secret it holds. */
export interface WebhookDef {
  id: string;
  secret: string;
  /** The header with the signature, as sha256=<hex of an HMAC of the body>: x-signature-256 unless said. */
  header?: string;
}

/** A handler entry the kernel runs by itself every so often, as the pack. */
export interface ScheduleDef {
  id: string;
  every_minutes: number;
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
 * A tree a pack declares over "is part of": a roadmap, for one. The `tree`
 * view reads it; nothing here is code.
 */
export interface TreeDef {
  id: string;
  title: string;
  description: string;
  /** Types a tree can start from. */
  roots: string[];
  /** Types that make up the tree's levels. */
  branches: string[];
  /** Types counted as the work under a branch: progress is how much of it is closed. */
  work: string[];
  /** The number field that orders branches among their siblings. */
  order: string;
  /** Statuses that mean someone is on it now. */
  active: string[];
}

/** One piece of a screen, drawn by the kernel: what it draws and from what. */
export interface PieceDef {
  piece: keyof typeof PIECES;
  /** For a tree: the tree it draws. */
  tree?: string;
  /** For rows from a view: the pack's view. */
  view?: string;
  /** For rows from a view: the input the item's id goes in. */
  item?: string;
  /** For an action's form: the pack's action. */
  action?: string;
  /** For a short note: what it says. */
  text?: string;
  /** For a picture: a lens's id, or the params of the lens view. From the item the page is of, unless it says. */
  lens?: string | Record<string, unknown>;
  /** For a picture: a style's id, or its fields (code aside: code runs only from a style kept on the map). */
  style?: string | Record<string, unknown>;
  /** For fields: the item's fields shown, in order. */
  fields?: string[];
  /** For a page the kernel still draws itself, until its pack draws it from pieces: its name. */
  page?: string;
  /** Its own heading, where the screen's title is not it. */
  title?: string;
  /** For attention: whose ("me", or nobody for everyone) and which reasons; on an item's page, only what is that item's. */
  person?: string;
  reasons?: string[];
}

/** What a pack shows on the page of every item of the kinds or types it is on: one column of pieces. */
export interface ScreenDef {
  id: string;
  title: string;
  /** The kinds or types on whose page it is shown. */
  on?: string[];
  /** Offered for the nav: a page of its own there once the owner adds it. */
  nav?: boolean;
  /** One of the kernel's own pages it is drawn on: Home, after the screens before it, until the owner takes it off. */
  at?: 'home';
  pieces: PieceDef[];
}

/**
 * The pieces the kernel draws, each with what it must be told. A tree, a gate, proof, usage and a document draw the
 * kernel's views of the item; a figure is the picture it keeps; rows and a form are the pack's own view and action.
 */
export const PIECES = { tree: ['tree'], gate: [], proof: [], usage: [], figure: [], document: [], view: ['view'], action: ['action'], note: ['text'], picture: ['lens'], fields: ['fields'], page: ['page'], attention: [] } as const;

/** The pages the kernel still draws itself, which a screen can hold as a piece until a pack draws them from pieces. */
export const PAGES = ['time'];

/** Every screen the packs declare, in the order the packs load. */
export const screensOf = (packs: PackFile[]) => packs.flatMap((pack) => (pack.screens ?? []).map((s) => ({ ...s, pack: pack.id })));

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
        for (const act of action.acts ?? []) if (!(pack.hosts ?? []).some((h) => h.id === act.host)) problems.push(`${at}: act "${act.id}" goes to undeclared host "${act.host}"`);
      } else if (!['rows', 'data'].includes((def as ViewDef).shape)) problems.push(`${at}: shape is rows or data`);
    }
  }
  for (const screen of pack.screens ?? []) {
    const at = `screen "${screen.id}"`;
    if (!own(screen.id)) problems.push(`${at} must be named "${pack.id}.<name>"`);
    if (!screen.title || !(screen.on?.length || screen.nav || screen.at) || !screen.pieces?.length) problems.push(`${at} needs a title, the kinds or types it is on or a place offered in the nav, and its pieces`);
    for (const t of screen.on ?? []) if (!types.has(t)) problems.push(`${at} is on unknown type "${t}"`);
    if (screen.at !== undefined && screen.at !== 'home') problems.push(`${at}: at is "home", the one kernel page a screen is drawn on`);
    for (const piece of screen.pieces ?? []) {
      const needs: readonly string[] | undefined = PIECES[piece.piece];
      if (!needs) problems.push(`${at}: "${piece.piece}" is not a piece: one of ${Object.keys(PIECES).join(', ')}`);
      for (const key of needs ?? []) if (!piece[key as keyof PieceDef]) problems.push(`${at}: a ${piece.piece} piece names its ${key}`);
      if (piece.tree && !(pack.trees ?? []).some((tree) => tree.id === piece.tree)) problems.push(`${at}: the pack declares no tree "${piece.tree}"`);
      if (piece.view && !(pack.views ?? []).some((v) => v.id === piece.view && v.shape === 'rows')) problems.push(`${at}: the pack declares no view "${piece.view}" of rows`);
      if (piece.action && !(pack.actions ?? []).some((a) => a.id === piece.action)) problems.push(`${at}: the pack declares no action "${piece.action}"`);
      if (piece.page && !PAGES.includes(piece.page)) problems.push(`${at}: the kernel draws no page "${piece.page}": one of ${PAGES.join(', ')}`);
      for (const r of piece.reasons ?? []) if (!(REASONS as readonly string[]).includes(r)) problems.push(`${at}: "${r}" is not a reason attention gives: one of ${REASONS.join(', ')}`);
      if (piece.style && typeof piece.style === 'object' && 'code' in piece.style) problems.push(`${at}: a picture's style has no code: code runs only from a style kept on the map`);
    }
  }
  for (const host of pack.hosts ?? []) if (!URL.canParse(host.base) || !/^https?:$/.test(new URL(host.base).protocol)) problems.push(`host "${host.id}": base is an http or https address`);
  for (const hook of pack.webhooks ?? []) if (!handler || !hook.secret) problems.push(`webhook "${hook.id}" needs the handler and the name of its secret`);
  for (const s of pack.schedules ?? []) if (!handler || !(s.every_minutes >= 1)) problems.push(`schedule "${s.id}" needs the handler and every_minutes of 1 or more`);
  return problems;
}
