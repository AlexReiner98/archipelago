# examples

Small packs to copy, off by default in [app/boot.ts](../../app/boot.ts). Each
fills a region of the page ([spec/frame.md](../../spec/frame.md)).

| File | Entry | What it shows you |
|---|---|---|
| [today.ts](today.ts) | `today` | A panel of your own: what's being worked on, in `left` |
| [column.ts](column.ts) | `column` | A frame of your own: the six regions in one column |

## Turn one on

The way a person or an agent turns one on is the same action, and it can be
undone:

```
page.set { pack: "today", on: true }
page.set { pack: "frame", on: false }   then   page.set { pack: "column", on: true }
```

`history.undo` with a change's id takes it back.

## Write your own

1. Copy `today.ts` to a new file, and change its `id`, region and view.
2. Add an entry to `app/boot.ts`. On dev the page reloads it as you edit.
3. Fill a region by its name: `top`, `left`, `center`, `right`, `bottom` or
   `over`. Add `when` to show it only alongside one view. Use style tokens,
   never colours of your own.
