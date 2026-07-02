# AIR MCP Server

The AIR MCP (Model Context Protocol) Server connects LLMs directly to your recorded AIR sessions. It provides tools for AI models to query, review, and generate tests based on semantic user flows.

## Quickstart

AIR MCP Server runs natively with any MCP-compatible client (like Claude Desktop or Gemini).

```bash
npx -y air-mcp-server@latest
```

## Prerequisites

- **Node.js 22+** (required for native `node:sqlite` support)
- You must have the [AIR VS Code Extension](https://marketplace.visualstudio.com/items?itemName=air-desktop.air) installed to record sessions.

## Capabilities

This server exposes three primary tools:

1. `list_recorded_sessions`: Discover all sessions recorded in your AIR database.
2. `get_session_flow_review`: Get a human-readable summary of a session (intents, pages, warnings).
3. `get_session_generation_context`: Fetch machine-readable step data (including the AIR Selector Proof Packets) for code generation.

## Usage with Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "air-mcp-server": {
      "command": "npx",
      "args": ["-y", "air-mcp-server@latest"]
    }
  }
}
```

## Using a Custom Database Path

By default, the server reads the database at `~/.air/air-data.db`. You can override this using the `--db` flag or environment variables:

```bash
npx -y air-mcp-server@latest --db /path/to/custom/air-data.db
```
