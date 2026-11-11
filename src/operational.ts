// What is stored that is not a fact anyone states (Rule 4 of the model). Every fact about the map changes through
// Archipelago.change; everything else lives in a store named here, with the one rule it keeps. test/structure.test.ts
// reads these lists: a table that is neither the map nor named here fails it, and so does a write to the map's
// tables outside src/pelago.ts and the projector it runs (src/replay.ts).

/**
 * The map itself: items, links and the log. Written only in src/pelago.ts. log_entry and log_fact are the log the
 * owner decided is the source of truth (docs/log.md), appended to and never changed; entity and relation are its
 * projections, written from its facts by src/replay.ts in the append's transaction (and, until the operational
 * streams hold them, by the operational writes). log_op holds the compacted streams (src/streams.ts): what is below
 * appended there at once, sealed by day in the fact stream and kept by the retention rules of the packs; what was done
 * that is neither a fact nor state is its activity stream (src/activity.ts), where the rows of the event table it
 * replaced were carried before schema step 34 dropped it.
 */
export const MAP_TABLES = ['entity', 'relation', 'log_entry', 'log_fact', 'log_op'];

/** The fields operational may write on an item. Anything else on an item is a fact, and changes through change. git is what stands was called on runs heard before 10 Nov 2026. */
export const KEPT_FIELDS = ['last_seen', 'active', 'busy', 'stands', 'git', 'tokens_used', 'story', 'stale_flagged', 'last_run', 'last_fired', 'last_result', 'rechecked_at'];

/** Tables beside the map, each with the rule it keeps. */
export const STORES: Record<string, string> = {
  token: "Who may act: stored as a hash; made, moved and revoked by a human, an admin or the server's setup, never by a change.",
  share: 'A link that lets someone with no login, or another workspace, read one document: made and revoked by a human only.',
  setting: "The workspace's settings and sealed secrets: set by the human or by the server, never by an agent's change; each set appended to the settings stream (a secret by its name only).",
  member: 'Who belongs to the workspace, by email: written by an admin or a server pack, read only by the whole database.',
  part_closure: 'What is inside what, all the way down: a projection of the open part_of links, kept by the projector in the append (src/closure.ts), made again whole after a restore.',
  bytes_added: "What each append adds to the log, in bytes, by the item or link its facts are about: rows only inserted by the append (src/bytes.ts), so writers at once never wait on each other, and folded into item_bytes and type_bytes before those are read.",
  item_bytes: "What each item (and all links, as one) adds to the log, in bytes, by its id and type: bytes_added folded under one lock (src/bytes.ts), made again whole from the log after a restore; never a fact, never backed up.",
  type_bytes: 'The bytes of item_bytes summed by type: kept with it.',
  mention: "What names an item in its note or fields: a projection of items' text, kept by the projector as each is written (src/mentions.ts), made again whole after a restore.",
  proposal: 'The review queue, a projection of the log: a held change’s record in the pending stream makes its row, the entry that decides it in the fact stream says what became of it (src/replay.ts).',
  reach: "What a view shared with a guest holds now, by share: worked out by the server as the person who shared it whenever the log has moved (src/guests.ts), and read by the reader role's policies; never a fact, never backed up.",
  published: 'A document as it was published, frozen: written only when a human publishes.',
  public_view: 'A view or an item made public, frozen as the person who shared it saw it: written only when a human shares it or publishes a document, and when it is taken down.',
  picture: 'The picture a test drew, kept for a public result: one per result, replaced when the test runs again; its hash appended to the observations stream.',
  act: 'A request a pack made outside the map: one that cannot be taken back waits for a person; once made it is logged, never undone.',
  type_def: "Every type and relation the packs declare, dormant ones included: written when a workspace opens, never by a change.",
  local_type: "A workspace's own types, kept beside the workspaces so the server can read them: written when one is defined.",
  transient: "Short-lived keys and values with an expiry: gone when they lapse, never part of a backup or the log; unlogged on a Postgres server. Among them the set of items each session touched (src/touched.ts), kept by run until a week after it was last heard from or ended, and where the owner’s page stands (src/seeing.ts), kept a day.",
  pack_store: 'Keys and values a server pack keeps, each pack its own: written through the pack host only.',
  control_workspace: 'The workspaces this server holds: written when one is made.',
  control_value: "The server's own keys and values, across workspaces.",
  github_installation: 'Which GitHub installation belongs to which workspace: written by the GitHub sign-up.',
  schema_version: 'Which schema steps have run: written by migrate only.',
  vault_key: "Each item's, link's and change set's key, wrapped with the server's sealing key: made in the append that first seals with it, deleted only by a forget, backed up apart and kept 30 days.",
  log_snapshot: 'The projections as they stood at a position of the log, sealed per item and anchored to the chain (src/snapshot.ts): taken by the server, never by a change, and deleted and taken again at will.',
  vault_secret: 'Retired (bug e_27zw6jt3): a store of secrets by name that nothing wrote. Step 20 still makes it; nothing reads or writes it, a backup leaves it out, and a later step drops it once no app before reads it.',
};

/**
 * The kernel's views that are not lenses (Rule 6 of the model: one way to read), each with what it reads instead of
 * a picture of the work. Every other view is a lens preset a pack declares (src/query-presets.ts) or a pack's own;
 * test/structure.test.ts refuses a kernel view named in neither place.
 */
export const VIEWS_OPERATIONAL: Record<string, string> = {
  sessions: 'The runs open now and the last that ended: the sessions store above, read as kept.',
  notifications: "The human's unread notifications: the notifications store above, newest first.",
  usage: "What the workspace's plan limits, used: the database's own count of each table's size, the counts kept beside the log (item_bytes), the sessions store's runs at work, and the server's counts of requests and looks.",
  spent: "What runs report they cost: the sessions store's tokens_used and cost_usd, summed by where they ran.",
  session_measures: "What sessions' turns tell over a range: the sessions store's events and the runs they are on, worked out into turns.",
  story: 'What a session told of its work: the story the sessions store keeps on its run.',
  turns: "A session's turns: the events the sessions store keeps on its run, worked out by the core pack's turnsOf.",
  changed_since: 'The log, counted and cut to its newest events: what happened, not what the map is.',
  style: 'How a page looks: the styles the packs ship and the map keeps, merged; the system tier, not the work.',
  saved_views: 'The views kept on the map, each named by the style that draws it: the system tier, not the work.',
  instructions: 'What agents are told: the instructions the packs ship and the map keeps, merged; the system tier, not the work.',
};

/** Restoring a backup writes the map's rows as they were, in src/pelago.ts (restoreRows): never re-applied as changes. */
export const RESTORE = 'restoreRows';
