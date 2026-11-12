// Run by path: `node src/backup.ts` (a restore, as docs/reference.md says). Its only job is to run the restore command of packs/log/kernel/backup.ts.

import { restoreCommand } from '../packs/log/kernel/backup.ts';

await restoreCommand(process.argv.slice(2));
