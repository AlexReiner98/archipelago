// What a pack offers agents and people: actions (its verbs, each specialising one of the kernel's six) and views
// (reads that write nothing), declared in its pack.json with JSON Schema inputs and run by its handler. The six
// verbs are declared by the core pack the same way. Checked when the pack loads.

import { REASONS } from './attention.ts';
import { parts } from './manifest.ts';
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
  /** Only a workspace's admin may call it: what it starts is paid for by the workspace. */
  admin?: boolean;
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
  /** Headers of the delivery the handler is given besides content-type, such as what kind of delivery it is. */
  headers?: string[];
}

/** A handler entry the kernel runs by itself every so often, as the pack, and with at_start once when its clocks start. */
export interface ScheduleDef {
  id: string;
  every_minutes?: number;
  at_start?: boolean;
  limit_ms?: number;
}

/** A kind of event another pack records that this one is told of, at its handler's entry of the same name. */
export interface HearDef {
  event: string;
  limit_ms?: number;
}

/** A server pack's host this pack reads from as its workspace's connection to that pack: only one the server pack lends. */
export interface ViaDef {
  pack: string;
  host: string;
}

export interface ViewDef {
  id: string;
  description: string;
  /** What it is asked with, as JSON Schema: a view the pack's code answers needs it. */
  input?: Record<string, unknown>;
  /** rows: one-line rows the kernel draws, each with an item; data: for agents only. */
  shape: 'rows' | 'data';
  limit_ms?: number;
  /** A view the kernel answers, never the pack's code: by the read its answer names (src/lens-presets.ts), with these fields (the brief's links, over). */
  lens?: Record<string, unknown>;
  /** With lens: which read answers it (one of LENS_ANSWERS); the flat lens when left out. */
  answer?: string;
  /** With lens: for a param, the lens fields each of its values stands for. */
  choices?: Record<string, Record<string, Record<string, unknown>>>;
}

/** The reads a view the kernel answers may name, each kept to the form its view had (src/lens-presets.ts). */
export const LENS_ANSWERS = ['flat', 'graph', 'tree', 'hubs', 'attention', 'brief'] as const;

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

/**
 * A reason attention gives that a pack declares: items of a type whose fields hold these values deserve it. It is
 * weighed whenever the reason it joins is asked for, and ranked just after it; an item nobody owns is the owner's.
 */
export interface ReasonDef {
  id: string;
  /** Its name, as attention answers it (why). */
  reason: string;
  description: string;
  /** The type of the items it is given to, flavours included. */
  of: string;
  /** The fields each must hold, and the values. */
  where: Record<string, string | number | boolean>;
  /** The kernel's reason it is weighed with: asked for that one, this one is too. */
  joins: string;
  /** Its mark, in a few words; the reason's name unless given. */
  mark?: string;
  /** What it asks of a person, as a verb. */
  ask?: string;
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
  /** For a picture: a kept view's id, or a flat lens ({ filter, walk, limit }, as query flat takes it), where "{here}" in its ids, link terms or within is the item the page is of. */
  lens?: string | Record<string, unknown>;
  /** For a picture: the types it draws of what its lens finds (flavours included); all of it when left out. */
  only?: string[];
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
  /** For attention and saved views: how many rows are shown; the rest are counted, by the project each is in. */
  limit?: number;
}

/**
 * How things look, as a pack ships it: a style preset, under every style the map keeps. On nothing, it is the
 * workspace's; on kinds or types, it is how the pictures and pages of such items look. How anything looks is a style
 * (docs: "Where does style live?"): the kernel draws what styles say, and keeps no values of its own.
 */
export interface StyleDef {
  id: string;
  /** The system type it is a preset of: a style unless it says, or an instruction (what agents are told, in body). */
  type?: string;
  title: string;
  body?: string;
  on?: string[];
  /** "workspace": on nothing, it lies over the workspace's own style kept about nothing, and under every nearer one. */
  over?: 'workspace';
  props: Record<string, unknown>;
}

/**
 * The code a picture of one shape is drawn by, as a pack ships it: its modules by name, each a file in the pack's
 * folder, entered at index.js (src/drawings.ts). The owner changes it by keeping their own version on the map.
 */
export interface DrawingDef {
  id: string;
  title: string;
  shape: string;
  modules: Record<string, string>;
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
 * kernel's views of the item; a figure is the picture it keeps; a diagram, the boxes and wires its props.diagram holds; rows and a form are the pack's own view and action.
 */
export const PIECES = { tree: ['tree'], gate: [], proof: [], usage: [], figure: [], document: [], view: ['view'], action: ['action'], note: ['text'], picture: ['lens'], fields: ['fields'], page: ['page'], attention: [], token: [], token_ask: [], saved_views: [], held: [], start: [], diagram: [] } as const;

/** The pages the kernel still draws itself, which a screen can hold as a piece until a pack draws them from pieces. */
export const PAGES = ['time'];

/** Every screen the packs declare, in the order the packs load. */
export const screensOf = (packs: PackFile[]) => packs.flatMap((pack) => parts(pack).screens.map((s) => ({ ...s, pack: pack.id })));
/** Every style preset the packs ship, in the order the packs load. */
/** The presets the packs ship of one system type, each with its pack: styles unless another type is asked for. */
export const presetsOf = (packs: PackFile[], type = 'style') => packs.flatMap((pack) => (pack.styles ?? []).filter((s) => (s.type ?? 'style') === type).map((s) => ({ ...s, pack: pack.id })));
export const stylesOf = (packs: PackFile[]) => presetsOf(packs);

/**
 * The kernel's own actions, each under one of the six verbs: an agent calls one as the verb's tool with its name
 * (src/surface.ts). change, the generic op, stays beneath them all, as do the tools that only read.
 */
export const KERNEL_VERBS: Record<string, string> = {
  session_start: 'capture',
  picture_put: 'capture',
  backup: 'capture',
  import_audit: 'capture',
  claim: 'assign',
  launch: 'assign',
  session_update: 'report',
  session_end: 'report',
  tell: 'report',
  run_report: 'report',
  rechecked: 'report',
  show: 'report',
  check_connections: 'report',
  health: 'report',
  notify: 'ask',
  publish_ask: 'ask',
  confirmed: 'settle',
  decide: 'settle',
  release: 'revise',
  places_put: 'revise',
  publish: 'revise',
  publish_all: 'revise',
  restart: 'revise',
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
  for (const [what, list] of [['action', parts(pack).actions], ['view', parts(pack).views]] as const) {
    for (const def of list) {
      const at = `${what} "${def.id}"`;
      if (!own(def.id)) problems.push(`${at} must be named "${pack.id}.<name>"`);
      if (seen.has(def.id)) problems.push(`${at} is declared twice`);
      seen.add(def.id);
      const preset = what === 'view' && (def as ViewDef).lens !== undefined;
      if (preset) {
        const view = def as ViewDef;
        if (typeof view.lens !== 'object' || view.lens === null || Array.isArray(view.lens)) problems.push(`${at}: lens is the fields of a lens`);
        if (view.answer !== undefined && !(LENS_ANSWERS as readonly string[]).includes(view.answer)) problems.push(`${at}: answer is one of ${LENS_ANSWERS.join(', ')}`);
      } else if (!handler) problems.push(`${at} needs the pack's handler.js: a verb with nothing to compute is a generic op`);
      if (!(preset && def.input === undefined) && !isObjectSchema(def.input)) problems.push(`${at}: input is the JSON Schema of an object`);
      if (def.limit_ms !== undefined && !(def.limit_ms > 0 && def.limit_ms <= 30_000)) problems.push(`${at}: limit_ms is at most 30000`);
      if (what === 'action') {
        const action = def as ActionDef;
        if (!verbs.includes(action.verb)) problems.push(`${at} specialises "${action.verb}", which is not a verb: one of ${verbs.join(', ')}`);
        for (const t of action.on ?? []) if (!types.has(t)) problems.push(`${at} acts on unknown type "${t}"`);
        for (const act of action.acts ?? []) if (!parts(pack).hosts.some((h) => h.id === act.host)) problems.push(`${at}: act "${act.id}" goes to undeclared host "${act.host}"`);
      } else if (!['rows', 'data'].includes((def as ViewDef).shape)) problems.push(`${at}: \`shape\` is rows or data`);
    }
  }
  for (const r of parts(pack).reasons) {
    const at = `attention reason "${r.id}"`;
    if (!own(r.id)) problems.push(`${at} must be named "${pack.id}.<name>"`);
    if (!/^[a-z][a-z0-9_]*$/.test(r.reason ?? '') || (REASONS as readonly string[]).includes(r.reason)) problems.push(`${at}: reason is a name of its own, not one of ${REASONS.join(', ')}`);
    if (!types.has(r.of)) problems.push(`${at} is of unknown type "${r.of}"`);
    if (!r.where || typeof r.where !== 'object' || !Object.keys(r.where).length) problems.push(`${at}: where names the fields its items hold`);
    else for (const f of Object.keys(r.where)) if (types.has(r.of) && !types.get(r.of)!.fields[f]) problems.push(`${at}: "${r.of}" has no field "${f}"`);
    if (!(REASONS as readonly string[]).includes(r.joins)) problems.push(`${at}: joins one of ${REASONS.join(', ')}`);
  }
  for (const screen of parts(pack).screens) {
    const at = `screen "${screen.id}"`;
    if (!own(screen.id)) problems.push(`${at} must be named "${pack.id}.<name>"`);
    if (!screen.title || !(screen.on?.length || screen.nav || screen.at) || !screen.pieces?.length) problems.push(`${at} needs a title, the kinds or types it is on or a place offered in the nav, and its pieces`);
    for (const t of screen.on ?? []) if (!types.has(t)) problems.push(`${at} is on unknown type "${t}"`);
    if (screen.at !== undefined && screen.at !== 'home') problems.push(`${at}: at is "home", the one kernel page a screen is drawn on`);
    for (const piece of screen.pieces ?? []) {
      const needs: readonly string[] | undefined = PIECES[piece.piece];
      if (!needs) problems.push(`${at}: "${piece.piece}" is not a piece: one of ${Object.keys(PIECES).join(', ')}`);
      for (const key of needs ?? []) if (!piece[key as keyof PieceDef]) problems.push(`${at}: a ${piece.piece} piece names its ${key}`);
      if (piece.tree && !parts(pack).trees.some((tree) => tree.id === piece.tree)) problems.push(`${at}: the pack declares no tree "${piece.tree}"`);
      if (piece.view && !parts(pack).views.some((v) => v.id === piece.view && v.shape === 'rows')) problems.push(`${at}: the pack declares no view "${piece.view}" of rows`);
      if (piece.action && !parts(pack).actions.some((a) => a.id === piece.action)) problems.push(`${at}: the pack declares no action "${piece.action}"`);
      if (piece.page && !PAGES.includes(piece.page)) problems.push(`${at}: the kernel draws no page "${piece.page}": one of ${PAGES.join(', ')}`);
      for (const r of piece.reasons ?? []) if (!(REASONS as readonly string[]).includes(r)) problems.push(`${at}: "${r}" is not a reason attention gives: one of ${REASONS.join(', ')}`);
      if (piece.lens && typeof piece.lens === 'object' && (typeof piece.lens.filter !== 'object' || !piece.lens.filter)) problems.push(`${at}: a view piece's lens is a flat lens: { filter, walk, limit }`);
      if (piece.style && typeof piece.style === 'object' && 'code' in piece.style) problems.push(`${at}: a view's style has no code: code runs only from a style kept on the map`);
    }
  }
  // A preset says only what a style can say, and carries no code: code runs only from a style kept on the map, where a person approves it.
  for (const style of pack.styles ?? []) {
    const at = `${style.type ?? 'style'} "${style.id}"`;
    const styleFields = types.get(style.type ?? 'style')?.fields ?? {};
    if (style.type !== undefined && !['style', 'instruction'].includes(style.type)) problems.push(`${at}: a preset is a style or an instruction`);
    if (style.type === 'instruction' ? typeof style.body !== 'string' || !style.body.trim() : style.body !== undefined) problems.push(`${at}: an instruction says its words in body, and only an instruction has one`);
    if (!own(style.id)) problems.push(`${at} must be named "${pack.id}.<name>"`);
    if (!style.title || !style.props || typeof style.props !== 'object') problems.push(`${at} needs a title and its props`);
    for (const t of style.on ?? []) if (!types.has(t)) problems.push(`${at} is on unknown type "${t}"`);
    for (const key of Object.keys(style.props ?? {})) if (!styleFields[key] || styleFields[key].system || ['code', 'on'].includes(key)) problems.push(`${at}: "${key}" is not a field a preset sets`);
  }
  for (const d of pack.drawings ?? []) {
    const at = `drawing "${d.id}"`;
    if (!own(d.id) || !d.title || !/^[a-z][a-z0-9_]*$/.test(d.shape ?? '')) problems.push(`${at} must be named "${pack.id}.<name>", with a title and the \`shape\` it draws`);
    if (typeof d.modules?.['index.js'] !== 'string') problems.push(`${at} needs its modules, entered at index.js`);
    for (const [name, file] of Object.entries(d.modules ?? {})) if (!/^[a-z][a-z0-9_-]*.js$/.test(name) || typeof file !== 'string' || file.includes('..')) problems.push(`${at}: "${name}" is not a module's name (a-z, ending .js) with a file in the pack`);
  }
  for (const host of parts(pack).hosts) if (!URL.canParse(host.base) || !/^https?:$/.test(new URL(host.base).protocol)) problems.push(`host "${host.id}": base is an http or https address`);
  for (const hook of parts(pack).webhooks) {
    if (!handler || !hook.secret) problems.push(`webhook "${hook.id}" needs the handler and the name of its secret`);
    for (const name of hook.headers ?? []) if (!/^[a-z0-9-]+$/.test(name) || /^(authorization|cookie)$/.test(name)) problems.push(`webhook "${hook.id}": "${name}" is not a header it may be given`);
  }
  // What it records in the log, beside its changes: the kernel's own kinds of event are the kernel's.
  for (const action of parts(pack).events) if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/.test(action) || /^(entity|relation|proposal|changeset|picture|session|pack)\./.test(action)) problems.push(`event "${action}" is not one a pack may record`);
  for (const s of parts(pack).schedules) if (!handler || !((s.every_minutes ?? 0) >= 1 || (s.at_start && s.every_minutes === undefined)) || !((s.limit_ms ?? 1) > 0 && (s.limit_ms ?? 1) <= 30_000)) problems.push(`schedule "${s.id}" needs the handler, every_minutes of 1 or more or at_start, and limit_ms of 30000 at most`);
  // What it is told of, what it reads through, and the map's tools a run it asks for may offer its model.
  for (const h of parts(pack).hears) if (!handler || !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/.test(h.event) || !((h.limit_ms ?? 1) > 0 && (h.limit_ms ?? 1) <= 30_000)) problems.push(`hears "${h.event}" needs the handler, an event's name and limit_ms of 30000 at most`);
  for (const v of parts(pack).via) if (!/^[a-z][a-z0-9_]*$/.test(v.pack ?? '') || !/^[a-z][a-z0-9_]*$/.test(v.host ?? '')) problems.push('via names a server pack and one of its hosts');
  for (const name of parts(pack).runs ?? []) if (!handler || !/^[a-z][a-z0-9_]*$/.test(name)) problems.push(`runs: "${name}" is not the name of a tool, or the pack has no handler`);
  return problems;
}
