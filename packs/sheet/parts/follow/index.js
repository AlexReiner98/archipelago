// The sheet follows the reading, as the sheet root's walled part (task e_ucsdgvfk; from the host's sheet-follow.js).
// With an item's page open beside a picture of documents, the page shown is the document in sight as it is scrolled
// to. The runtime measures where the reading is and tells this part as it scrolls ({ name: 'scrolled', reading:
// { item, open, held, unsaved } }, hooks.tellSlot on the slot `sheet`); this part decides, and names the page
// (tools.go with replace, so moving on is a step of no one's history). It never leaves words unsaved behind, and waits
// while the documents above the one opened still take their height. It draws nothing.

/** Where to go, given the reading: the item in sight, or nothing. */
export function followTo(reading) {
  const open = reading?.open, there = reading?.item;
  if (!open || !there || there === open || reading.held || reading.unsaved) return null;
  if (!/^e_[a-z0-9]{8}$/.test(there)) return null;
  return { item: there, replace: true };
}

export default function follow(_input, tools) {
  return {
    marks: ['box'],
    update: () => ['box'],
    on(event) {
      if (event?.name !== 'scrolled') return undefined;
      const to = followTo(event.reading);
      if (to) tools.go?.(to);
      return undefined;
    },
  };
}
