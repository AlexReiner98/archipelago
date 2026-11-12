// Run by path: `node src/server.ts` (the hosted image's command until it runs src/boot.ts). Its only job is to run the server as `node src/boot.ts` does.

import { run } from './boot.ts';

await run();
