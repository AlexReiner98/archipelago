// surface.mcp: what this pack adds to the surface's MCP server (packs/surface/kernel/mcp.ts): the capability it says
// it speaks, what a tool's listing carries (only draw names the page), and the page offered as a resource.

import { registerView, toolView, VIEW_CAPABILITY } from './mcp-view.ts';

export const mcpApps = () => ({ capability: VIEW_CAPABILITY, toolView, register: registerView });
