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
- **Left and right:** fills stacked, each under its `title`. Widths are the
  tokens `frame-left` and `frame-right`.
- **Center:** one fill at a time, the one `here.view` names, else the first.
  The frame sets `here.view` to what it shows. The [tabs](../tabs/README.md)
  pick it.
- **Over:** a layer above the page. Only its fills take the pointer.

Injects `slot.fill`, `slot.read`, `here.read` and `here.set`. Its sheet uses
style tokens only.
