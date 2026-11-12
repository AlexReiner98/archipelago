// The log root's parts of the schema's numbered steps (src/migrate.ts): the log, its streams, partitions, snapshots and
// the projections it makes; and what the log does to a database each time it is opened, once its steps are in.

import type { Database } from '../../database/kernel/db.ts';
import type { StepPart } from '../../database/kernel/migrate.ts';
import { LOG } from './log.ts';
import { ACTIVITY, ACTIVITY_STREAM, EVENT_GONE, OP_ABOUT, PRE_LOG_ACTIVITY } from './activity-steps.ts';
import { carryEventTable } from './activity.ts';
import { OPLOG, OPLOG_GUARDED, OPLOG_SERVER } from './oplog.ts';
import { makePartitions, PARTITION } from './partitions.ts';
import { SNAPSHOT } from './snapshot.ts';
import { CLOSURE } from './closure.ts';
import { ITEM_BYTES } from './bytes.ts';

export const STEPS: StepPart[] = [
  { version: 18, name: 'the log: change sets appended, hash-chained', sql: LOG },
  { version: 19, name: 'the activity log read from the log', sql: ACTIVITY },
  { version: 21, name: 'the compacted streams, in segments', sql: OPLOG, server: OPLOG_SERVER },
  { version: 22, name: 'the log cut by year', sql: PARTITION },
  { version: 23, name: 'snapshots of the projections, and room to rebuild them', sql: SNAPSHOT },
  { version: 24, name: 'the compacted streams sealed, guarded by row, and reached by a forget', sql: OPLOG_GUARDED },
  // The database root's indexes and row policies follow the closure (packs/database/kernel/steps.ts).
  { version: 25, name: 'what is inside what, what names what, the indexes reads are bounded by, and visibility asked row by row', sql: CLOSURE },
  { version: 27, name: 'the activity from before the log began, gone', sql: PRE_LOG_ACTIVITY },
  { version: 28, name: 'what each item adds to the log, in bytes', sql: ITEM_BYTES },
  { version: 33, name: 'what was done outside change sets, in the activity stream', sql: ACTIVITY_STREAM },
  // What a forget reaches of the stores follows, the write root's (packs/write/kernel/steps.ts).
  { version: 34, name: 'the event table, carried into the activity stream and gone', sql: EVENT_GONE, before: carryEventTable },
  { version: 38, name: 'what the compacted streams say about an item, found by its index under the row policy', sql: OP_ABOUT },
];

/** Each time a database is opened, once its steps are in: the log's partitions, made ahead of need (src/partitions.ts). */
export const OPENED: ((db: Database) => Promise<unknown>)[] = [(db) => makePartitions(db)];
