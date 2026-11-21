# tabs

Fills the region `top` with two things:

- `name`: the page's name.
- `tabs`: a tab for each fill in `center`, by its title.

A tab sets `here.view`. The URL's hash follows it: `#map`, or `#pack/name`
when a pack has two views. A link opens that view, even when the view's pack
loads after this one. Turn it off and the frame still shows the first view.

Injects `slot.fill`, `slot.read`, `here.read` and `here.set`.
