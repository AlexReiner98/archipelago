// The database root's parts of the schema's numbered steps (src/migrate.ts): the tables, policies and functions every
// map is kept in. Each root declares its own parts in its kernel/steps.ts; a step, once released, is never edited.

import type { StepPart } from './migrate.ts';
import { AGENT_CODE_READ, AGENT_PUBLISH_READ, HELD_BY, HOLDS_OFF_READ, ITEM_HIDDEN, LINK_SNAPSHOT, MEMBER, ORDERED, SCHEMA, SETTING_READ_OPEN, TOKEN_GRANT, TOKEN_SCOPE, VISIBILITY, WORKSPACE_SHARE } from './schema.ts';
import { PUBLIC_DOCUMENT, PUBLIC_VIEW, PUBLISHED, PUBLISHED_PATH, PUBLISHED_TO_PUBLIC_VIEW, PUBLIC_VIEW_SHOWS, SHARE_PUBLISHABLE, SHARE_WORKSPACE_GONE } from './public-schema.ts';
import { MENTIONS } from './mentions.ts';
import { ACTIVE_HOLDS_BY_KEY, READ_INDEXES, ROW_POLICIES } from './read-indexes.ts';
import { GUESTS_GONE, MEMBER_READ_ONLY, VAULT_KEY_POLICY } from './member-schema.ts';

export const STEPS: StepPart[] = [
  // What every database had before steps were numbered, written so it can run again over it: a database made then
  // takes it as its first step without harm.
  { version: 1, name: 'the schema before versions', sql: `create extension if not exists pg_trgm;\n${SCHEMA}\n${VISIBILITY}` },
  { version: 2, name: 'writes in order on a server', sql: '', server: ORDERED },
  { version: 5, name: 'a token is within some items, and may report, propose or change', sql: TOKEN_SCOPE },
  { version: 6, name: 'members sign in by their email address', sql: MEMBER },
  { version: 7, name: 'a document shared with another workspace', sql: WORKSPACE_SHARE },
  { version: 9, name: 'a public document, read by anyone', sql: PUBLIC_DOCUMENT },
  { version: 10, name: 'a document as it was published', sql: PUBLISHED },
  { version: 11, name: 'a published document at an address word', sql: PUBLISHED_PATH },
  { version: 12, name: 'an agent reads whether it may publish', sql: AGENT_PUBLISH_READ },
  { version: 14, name: 'an agent reads whether it may change the code drawings run', sql: AGENT_CODE_READ },
  { version: 16, name: 'a held change keeps the rule that held it', sql: HELD_BY },
  // Step 25 begins with the log's closure (packs/log/kernel/steps.ts).
  { version: 25, part: 1, sql: MENTIONS + READ_INDEXES + ROW_POLICIES + ACTIVE_HOLDS_BY_KEY },
  { version: 26, name: 'a document shared with another workspace may be published there', sql: SHARE_PUBLISHABLE },
  { version: 29, name: 'a token a person granted a client by signing in', sql: TOKEN_GRANT },
  { version: 31, name: 'an agent reads whether holds are off', sql: HOLDS_OFF_READ },
  { version: 35, name: 'a get says hidden, not missing', sql: ITEM_HIDDEN },
  { version: 36, name: 'a view shared with a guest, read live and nothing else', sql: VAULT_KEY_POLICY },
  { version: 37, name: 'a link keeps its view frozen, read by a short token', sql: LINK_SNAPSHOT },
  { version: 39, name: 'shares made out to another workspace, gone', sql: SHARE_WORKSPACE_GONE },
  { version: 40, name: 'a view or an item made public, frozen as it was shared', sql: PUBLIC_VIEW },
  { version: 41, name: 'what is published, made its public view', sql: PUBLISHED_TO_PUBLIC_VIEW },
  { version: 42, name: 'a member who only reads', sql: MEMBER_READ_ONLY },
  { version: 43, name: 'guests, gone', sql: GUESTS_GONE },
  { version: 44, name: 'what a public view shows, indexed', sql: PUBLIC_VIEW_SHOWS },
  { version: 45, name: 'a member reads the settings packs open to members', sql: SETTING_READ_OPEN },
];
