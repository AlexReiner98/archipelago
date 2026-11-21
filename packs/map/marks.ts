/**
 * Marks for states, by the spec's rule (spec/style.md): shape from the
 * base, side from where the status sits, never the type's name. The glyph
 * and its colour are the style's tokens. The item page draws by the same
 * rule.
 */
import type { Json } from "../../spec/common.ts";
import type { TypeInfo } from "../../spec/types.ts";
import { glyph, read, shape, side } from "../../spec/style.ts";

export { shape, side, type Side } from "../../spec/style.ts";

/** The glyph token of an item's mark. */
export const markToken = (bases: string[], t: TypeInfo | undefined, status: Json | undefined) => glyph(shape(bases, t), side(t, status));

/** The glyph of an item's mark, as the style draws it now. */
export const mark = (bases: string[], t: TypeInfo | undefined, status: Json | undefined) => read(markToken(bases, t, status));
