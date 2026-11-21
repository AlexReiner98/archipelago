# legend

Every mark the map draws, floated in the region `over` at the bottom left
while the map is shown (`when: { "here.view": "map/map" }`). It lists:

- each base with each of its statuses, as marks by the spec's rule
  ([spec/style.md](../../spec/style.md));
- what lit means;
- each kind of link.

It reads only the types from `find.index`. Turn it off and the map is
unchanged. Injects `find.index` and `slot.fill`.
