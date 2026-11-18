// A piece of a chat's row (./session-pieces.js): its name, cut short, which a press opens the chat's page from.

export default function name(s) {
  return { word: s.title ?? s.label ?? s.name ?? s.id, cls: 'isl-name', opens: true };
}
