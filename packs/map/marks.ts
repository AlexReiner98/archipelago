/**
 * Marks for states, by the spec's rule (spec/style.md): shape from the
 * base, side from where the status sits, never the type's name. The glyph
 * and its colour are the style's tokens. The item page draws by the same
 * rule.
 */
import type { Json } from "../../spec/common.ts";
import type { TypeInfo } from "../../spec/types.ts";
import { markGlyph, markShape, read, side, type MarkShape } from "../../spec/style.ts";

export { side, type Side } from "../../spec/style.ts";

/** The glyph token of an item's mark; `marks` is every base's shape (types.mark, edition 10). */
export const markToken = (marks: Readonly<Record<string, MarkShape>>, t: TypeInfo | undefined, status: Json | undefined) => markGlyph(markShape(marks, t), side(t, status));

/** The glyph of an item's mark, as the style draws it now. */
export const mark = (marks: Readonly<Record<string, MarkShape>>, t: TypeInfo | undefined, status: Json | undefined) => read(markToken(marks, t, status));
