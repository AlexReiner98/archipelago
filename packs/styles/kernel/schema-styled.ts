// answer.schema_styled: the registry's description with its screens and style presets as the asking map keeps them
// (./screens.ts, withScreens; ./styles.ts, withStyles), for the surface's schema read given to a person or asked whole.

import type { KernelContext } from '#pelago/kernel';
import { withScreens, type ScreenDef } from './screens.ts';
import { withStyles, type Preset } from './styles.ts';

type Described = { screens: (ScreenDef & { pack: string })[]; styles: Preset[] };

export const schemaStyled = async (ctx: KernelContext, input: { described: Described }) => withStyles(ctx, await withScreens(ctx, input.described));
