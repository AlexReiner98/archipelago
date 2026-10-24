// What is stored that is not a fact anyone states (Rule 4 of the model). Every fact about the map changes through
// Archipelago.change; everything else lives in a store named here, with the one rule it keeps. test/structure.test.ts
// reads these lists: a table that is neither the map nor named here fails it, and so does a write to the map's
// tables outside src/pelago.ts.

/** The map itself: items, links and the log. Written only in src/pelago.ts. */
export const MAP_TABLES = ['entity', 'relation', 'event'];

/**
 * State kept on the map's own items that skips approval. It takes effect at once and is never held, through the
 * operational writes in src/pelago.ts (operational, claim, release, and apply for what is made at once).
 */
export const ON_THE_MAP: Record<string, string> = {
  sessions: "A run's heartbeat (last_seen, active, busy), its tokens_used (shared onto the work it is on) and its story: kept at once by operational, out of the item's history; its start and end are logged changes.",
  claims: 'A holds link from holder to resource: made by claim and ended by release, at once, each logged.',
  notifications: 'A notification item, made by apply at once and never held; who may read it is set by operational.',
  automations: "An automation's last_run, last_fired and last_result: kept by operational, the firing itself logged.",
  rechecks: "A project's rechecked_at: kept by operational, the re-check itself logged.",
  kinds: "An item's kind column, read from its type: filled by fillKinds when a workspace opens, and by the database for a row written without it; never a fact anyone states.",
};

/** The fields operational may write on an item. Anything else on an item is a fact, and changes through change. */
export const KEPT_FIELDS = ['last_seen', 'active', 'busy', 'tokens_used', 'story', 'stale_flagged', 'last_run', 'last_fired', 'last_result', 'rechecked_at'];

/** Tables beside the map, each with the rule it keeps. */
export const STORES: Record<string, string> = {
  token: "Who may act: stored as a hash; made, moved and revoked by a human, an admin or the server's setup, never by a change.",
  share: 'A link that lets someone with no login, or another workspace, read one document: made and revoked by a human only.',
  setting: "The workspace's settings and sealed secrets: set by the human or by the server, never by an agent's change.",
  member: 'Who belongs to the workspace, by email: written by an admin or a server pack, read only by the whole database.',
  proposal: 'A change held for a human: written by change when it holds, decided by decide; what it would do is ops, applied through apply.',
  published: 'A document as it was published, frozen: written only when a human publishes.',
  picture: 'The picture a test drew, kept for a public result: one per result, replaced when the test runs again.',
  act: 'A request a pack made outside the map: one that cannot be taken back waits for a person; once made it is logged, never undone.',
  type_def: "Every type and relation the packs declare, dormant ones included: written when a workspace opens, never by a change.",
  local_type: "A workspace's own types, kept beside the workspaces so the server can read them: written when one is defined.",
  transient: 'Short-lived keys and values with an expiry: gone when they lapse, never part of a backup.',
  pack_store: 'Keys and values a server pack keeps, each pack its own: written through the pack host only.',
  control_workspace: 'The workspaces this server holds: written when one is made.',
  control_value: "The server's own keys and values, across workspaces.",
  github_installation: 'Which GitHub installation belongs to which workspace: written by the GitHub sign-up.',
  schema_version: 'Which schema steps have run: written by migrate only.',
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
