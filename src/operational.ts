// What is stored that is not a fact anyone states (Rule 4 of the model). Every fact about the map changes through
// Archipelago.change; everything else lives in a store named here, with the one rule it keeps. test/structure.test.ts
// reads these lists: a table that is neither the map nor named here fails it, and so does a write to the map's
// tables outside src/pelago.ts and the projector it runs (src/replay.ts).

/**
 * The map itself: items, links and the log. Written only in src/pelago.ts. log_entry and log_fact are the log the
 * owner decided is the source of truth (docs/log.md), appended to and never changed; entity and relation are its
 * projections, written from its facts by src/replay.ts in the append's transaction (and, until the operational
 * streams hold them, by the operational writes). event holds only what is not a fact: what a change set did is read
 * from the log. log_op holds the compacted streams (src/streams.ts): what is below appended there at once, sealed by
 * day in the fact stream and kept by the retention rules of the packs.
 */
export const MAP_TABLES = ['entity', 'relation', 'event', 'log_entry', 'log_fact', 'log_op'];

/**
 * State kept on the map's own items that skips approval. It takes effect at once and is never held, through the
 * operational writes in src/pelago.ts (operational, claim, release, and apply for what is made at once).
 */
export const ON_THE_MAP: Record<string, string> = {
  sessions: "A run's tokens_used (shared onto the work it is on), story and stale flag: kept at once by operational and appended to the sessions stream; its start, end and task are facts; its heartbeat (last_seen, active, busy) is in no stream.",
  claims: 'A holds link from holder to resource: made by claim and ended by release, at once, appended to the claims stream.',
  notifications: 'A notification item, made by apply at once and never held; who may read it is set by operational and appended to the notifications stream.',
  automations: "An automation's last_run, last_fired and last_result, the event cursor and run_once marks: kept at once, appended to the automations stream.",
  rechecks: "A project's rechecked_at: kept by operational, appended to the automations stream.",
  places: "Where a person put an item on a canvas: one place per canvas and item (the field place:<canvas>, its value [x, y]), written in one batch by places_put and read by places (src/canvas-places.ts), appended at once to the places stream and never an item or a link; compacted to the newest per canvas and item.",
  kinds: "An item's kind column, read from its type: filled by fillKinds when a workspace opens, and by the database for a row written without it; never a fact anyone states.",
};

/** The fields operational may write on an item. Anything else on an item is a fact, and changes through change. */
export const KEPT_FIELDS = ['last_seen', 'active', 'busy', 'tokens_used', 'story', 'stale_flagged', 'last_run', 'last_fired', 'last_result', 'rechecked_at'];

/** Tables beside the map, each with the rule it keeps. */
export const STORES: Record<string, string> = {
  token: "Who may act: stored as a hash; made, moved and revoked by a human, an admin or the server's setup, never by a change.",
  share: 'A link that lets someone with no login, or another workspace, read one document: made and revoked by a human only.',
  setting: "The workspace's settings and sealed secrets: set by the human or by the server, never by an agent's change; each set appended to the settings stream (a secret by its name only).",
  member: 'Who belongs to the workspace, by email: written by an admin or a server pack, read only by the whole database.',
  part_closure: 'What is inside what, all the way down: a projection of the open part_of links, kept by the projector in the append (src/closure.ts), made again whole after a restore.',
  mention: "What names an item in its note or fields: a projection of items' text, kept by the projector as each is written (src/mentions.ts), made again whole after a restore.",
  proposal: 'The review queue, a projection of the log: a held change’s record in the pending stream makes its row, the entry that decides it in the fact stream says what became of it (src/replay.ts).',
  published: 'A document as it was published, frozen: written only when a human publishes.',
  picture: 'The picture a test drew, kept for a public result: one per result, replaced when the test runs again; its hash appended to the observations stream.',
  act: 'A request a pack made outside the map: one that cannot be taken back waits for a person; once made it is logged, never undone.',
  type_def: "Every type and relation the packs declare, dormant ones included: written when a workspace opens, never by a change.",
  local_type: "A workspace's own types, kept beside the workspaces so the server can read them: written when one is defined.",
  transient: 'Short-lived keys and values with an expiry: gone when they lapse, never part of a backup or the log; unlogged on a Postgres server.',
  pack_store: 'Keys and values a server pack keeps, each pack its own: written through the pack host only.',
  control_workspace: 'The workspaces this server holds: written when one is made.',
  control_value: "The server's own keys and values, across workspaces.",
  github_installation: 'Which GitHub installation belongs to which workspace: written by the GitHub sign-up.',
  schema_version: 'Which schema steps have run: written by migrate only.',
  vault_key: "Each item's, link's and change set's key, wrapped with the server's sealing key: made in the append that first seals with it, deleted only by a forget, backed up apart and kept 30 days.",
  log_snapshot: 'The projections as they stood at a position of the log, sealed per item and anchored to the chain (src/snapshot.ts): taken by the server, never by a change, and deleted and taken again at will.',
  vault_secret: 'Secrets kept by name, wrapped like a key: set and removed by the owner or the server, never in the log or its backups.',
};

/**
 * The kernel's views that are not lenses (Rule 6 of the model: one way to read), each with what it reads instead of
 * a picture of the work. Every other view is a lens preset a pack declares (src/lens-presets.ts) or a pack's own;
 * test/structure.test.ts refuses a kernel view named in neither place.
 */
export const VIEWS_OPERATIONAL: Record<string, string> = {
  sessions: 'The runs open now and the last that ended: the sessions store above, read as kept.',
  notifications: "The human's unread notifications: the notifications store above, newest first.",
  spent: "What runs report they cost: the sessions store's tokens_used and cost_usd, summed by where they ran.",
  story: 'What a session told of its work: the story the sessions store keeps on its run.',
  changed_since: 'The log, counted and cut to its newest events: what happened, not what the map is.',
  style: 'How a page looks: the styles the packs ship and the map keeps, merged; the system tier, not the work.',
  saved_views: 'The views kept on the map, each named by the style that draws it: the system tier, not the work.',
};

/** Restoring a backup writes the map's rows as they were, in src/pelago.ts (restoreRows): never re-applied as changes. */
export const RESTORE = 'restoreRows';
