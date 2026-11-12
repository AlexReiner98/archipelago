// Run by path: `node src/deploy.ts` (npm run migrate, and the hosted deploy and staging scripts). Its only job is to run the deploy, packs/identity/kernel/deploy.ts.

import { deploy } from '../packs/identity/kernel/deploy.ts';

await deploy();
