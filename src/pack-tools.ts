// Tools that are a pack's, offered only while that pack is loaded: with it gone they leave the tool list rather
// than answer wrong. A stopgap until packs declare their own actions and views (the task "Actions and views
// declared in pack files"), when each tool will come from its pack and this list goes.

export const PACK_TOOLS: Record<string, string[]> = {
  time: ['time_log', 'timesheet', 'week', 'invoice_draft', 'invoice_paid', 'invoice_void'],
};
