// The write root's parts of the schema's numbered steps (src/migrate.ts): an item's kind in its row, and what a forget
// reaches.

import type { StepPart } from '../../database/kernel/migrate.ts';
import { ITEM_KIND } from '../../loader/kernel/head.ts';
import { FORGET, FORGET_STORES, LINK_TO } from './forget.ts';

export const STEPS: StepPart[] = [
  { version: 15, name: 'an item keeps its kind in its row', sql: ITEM_KIND },
  // After the seal's vault (packs/seal/kernel/steps.ts).
  { version: 20, part: 1, sql: FORGET },
  // After the log's carry of the event table (packs/log/kernel/steps.ts).
  { version: 34, part: 1, sql: FORGET_STORES },
  // A forget finds every link an item was ever at either end of, by an index on each end (wave 7).
  { version: 46, name: 'a link found in the log by its far end', sql: LINK_TO },
];
