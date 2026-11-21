# frame

The page around the canvas. Edition 7. It is built from [slots](slot.md),
and the spec owns only two things: the names of six regions, and what a
fill carries. The frame itself is a pack, and anyone can write one. Types:
[slot.ts](slot.ts).

```
┌──────────────── top ────────────────┐
├─ left ─┬────── center ─────┬─ right ─┤      over: above all of them
├────────┴──── bottom ───────┴─────────┤
```

## Regions

`top` `left` `center` `right` `bottom` `over` (`REGIONS`). They are
slots, reserved like `root` and declared by the slot broker, so they are
always there. Each is `many`. A region has a place on the page and no
role: nothing in the spec says what goes where.

## A frame

A frame is any pack that fills `root` and shows the six regions. It
decides how several fills share a region: side by side, stacked, behind
tabs. It reads each region's fills with `slot.read` and draws a fill with
its `Slot`. Turn one frame off and turn another on, and every fill lands
in the new one unchanged.

## A fill

`fill({ slot, name, title, when, view })`, where `slot` is a region, or a
slot a pack declared.

- **`title`**: what a frame shows for it, as a tab or a heading.
- **`when`**: the fill shows only while `here` matches. `{ "here.view":
  "harness/run" }` matches that value. `{ "here.item": true }` matches
  any value that is set.
- **`here.view`**: the fill shown in `center`, as `pack/name`. The frame
  sets it. A fill elsewhere uses it to show alongside one view.

## Arranging

Where a fill shows is config, not code. The slot broker's config holds
`arrange`, keyed by `pack/name`: a region or slot moves the fill there,
and `"off"` hides it. Order stays the config tree's. So a person or an
agent rearranges the page by changing config, which can be undone like
any change.
