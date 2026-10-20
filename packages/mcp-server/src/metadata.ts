// Server identity and the published tool inventory used by the
// interoperability profile. Keeping the list here (and asserting it against
// the real McpServer in tests) prevents the well-known metadata from drifting
// away from the tools that are actually registered.

export const SERVER_NAME = "portaless-mcp-server";
export const SERVER_VERSION = "0.0.1";
export const MCP_HTTP_PATH = "/mcp";

export const MCP_TOOL_NAMES = [
  "apply_theme",
  "approve_page_revision",
  "create_page",
  "delete_block",
  "get_page_context",
  "get_site_context",
  "grant_capability",
  "insert_block",
  "list_installed_plugins",
  "list_page_components",
  "list_page_proposals",
  "list_themes",
  "propose_page_revision",
  "query_usage_log",
  "read_documentation",
  "read_private_page_context",
  "revoke_permission",
  "update_block",
  "update_page",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
