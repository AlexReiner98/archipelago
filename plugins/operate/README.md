# operate

Page side: the look of a tool people work in. It follows the Operate mode
of [Impeccable](https://github.com/pbakaus/impeccable) (Apache-2.0): its
ideas, in this plugin's own words and code. The tool disappears into the
task: familiar controls, restraint, density with room between groups.

It starts narrow. It styles only what `scope` names, the Games page of
[game](../game/README.md) by default, and leaves every other view as the
[style](../style/README.md) plugin draws it.

| File | Runs | What it is |
|---|---|---|
| [view.ts](view.ts) | page | One sheet for the scope (`operateSheet`): the [style tokens](../../spec/style.md) set again there, and the scope's own elements given their states. Injects nothing |

## What it changes inside the scope

| | Operate | Before |
|---|---|---|
| Type | One family, a tight fixed scale (11, 13, 14, 17 px), tabular numerals | 10 to 15 px, proportional numerals |
| Colour | Restrained: the accent only for the selection, focus and the equilibrium; a second neutral layer for the list and the matrix headers; tints mixed from the style's own colours, none of its own | The accent on hover and selection alike |
| Space | Tight within a group, wider between groups (4 to 20 px), prose at most 72 characters | 2 to 10 px throughout |
| Controls | Buttons, inputs and selects one height, with hover, pressed, selected, disabled and a visible keyboard focus ring | Hover only |
| Motion | Colour changes of 150 ms, for state only; none with reduced motion | None |
| Labels | "In plain words" a sentence-case heading, not a tracked all-caps label | All caps |
| Browser parts | Selection, caret, checkboxes and scrollbars in the style's colours | Browser defaults |

Every rule starts `body <scope>`, one step more specific than the page's
own, so it wins whichever sheet loads first. Unloaded, the sheet goes and
the page is as its plugin draws it.

## Config

| Key | Default | |
|---|---|---|
| `scope` | `.gm` | The element the look applies inside: one class selector. Anything else is refused |

To take it wider later, give it another scope or a second entry in the
page's tree ([app/boot.ts](../../app/boot.ts)), one page at a time.
