// A trial of Plane with one solve in place of its stages (./solve.js), as a form of its own to look at beside it.

import { layout as planar } from './bars.js';

export { latest } from './bars.js';

export const layout = (args) => planar({ ...args, sizes: { ...args.sizes, plane_solve: 1 } });
