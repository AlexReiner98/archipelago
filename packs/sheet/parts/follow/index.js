// The sheet follows the reading, as the sheet root's walled part (task e_ucsdgvfk; from the host's sheet-follow.js).
// With an item's page open beside a picture of documents, the page shown is the document in sight as it is scrolled
// to. The runtime measures where the reading is and hands it as `reading` ({ item: the id in sight, held: true while
// the documents above it are still taking their height }); this part decides, and goes there. It never leaves words
// unsaved behind: while the page says it holds any (page state draft), it stays. It draws nothing.

/** Where to go, given the address and the reading: the item in sight, or nothing. */
export function followTo(address, reading) {
  const open = address?.item;
  const there = reading?.item;
  if (!open || !there || there === open || reading.held || reading.unsaved) return null;
  if (!/^e_[a-z0-9]{8}$/.test(there)) return null;
  return { item: there, replace: true };
}

export default function follow(input, tools) {
  let now = input;
  const step = () => {
    const to = followTo(now?.address, now?.reading);
    if (to) tools.go?.(to);
  };
  return {
    marks: ['box'],
    update(next) {
      now = next;
      step();
      return ['box'];
    },
  };
}
