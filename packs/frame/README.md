# frame

The frame we ship ([spec](../../spec/frame.md)). It fills `root` with the six
regions and nothing in them. Any pack that fills `root` can take its place.

```
┌──────────── top ────────────┐
├ left ┬──── center ────┬ right ┤   over: above all
├──────┴──── bottom ────┴───────┤
```

- **A region with no fills takes no room.**
- **Top and bottom:** fills in a row, in config order.
- **Left and right:** fills stacked, sharing the height, each under its
  `title` when there are two or more. Widths are the
  tokens `frame-left` and `frame-right`, at most 28% and 32% of the window.
- **Folding:** a side folds to a thin rail with its fills' titles, from a
  tab on its inner edge ([fold.ts](fold.ts)). A title on the rail opens
  that fill; the rest of the rail opens them all. In an open side, a fill's
  title shuts it to one line, and a click on that line opens it again.
  The folded fills are the page key `frame.folded` (fill keys,
  `pack/name`); a side is a rail when every fill it shows is folded. The
  page starts with the config's `folded`, so the harness view lands with
  its node and run panes folded, and any pack opens one by taking
  its fill out of the list.
- **Center:** one fill at a time, the one `here.view` names, else the first.
  The frame sets `here.view` to what it shows. The [views](../views/README.md)
  pick it.
- **Over:** a layer above the page. Only its fills take the pointer.

Injects `slot.fill`, `slot.read`, `here.read`, `here.set` and
`here.declare`. The folds are tested in `test/frame.test.ts`. Its sheet uses
style tokens only.
