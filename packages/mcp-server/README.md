# AIR MCP Server

AIR should be consumable by any MCP-capable host, not only one IDE or one assistant.

## Recommended host contract

Use a stable Node launcher instead of editor-specific `npx` or relative `tsx` commands.

- `command`: `node`
- `args`: `["/absolute/path/to/Air Desktop/scripts/air-mcp.cjs"]`
- `env.AIR_MCP_DB_PATH`: absolute path to the AIR SQLite database

Why this contract is safer:

- It does not depend on the host process `cwd`.
- It does not depend on `npx` behavior.
- It works the same way across VS Code, Codex, Cursor, and other MCP hosts.
- The server path resolution stays inside the AIR repo.

## Stdio mode

This is the default transport and is the right choice for IDE-integrated MCP clients.

Example command line:

```bash
node scripts/air-mcp.cjs --db C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db
```

Or with environment variables:

```bash
set AIR_MCP_DB_PATH=C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db
node scripts/air-mcp.cjs
```

## HTTP mode

Use HTTP mode when a remote tool-calling runtime needs a network-reachable MCP endpoint.

Example:

```bash
node scripts/air-mcp.cjs --transport http --db C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db --port 3333
```

Environment-based example:

```bash
set AIR_MCP_DB_PATH=C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db
set AIR_MCP_PORT=3333
node scripts/air-mcp.cjs --transport http
```

Endpoints:

- MCP: `http://localhost:3333/mcp`
- Health: `http://localhost:3333/health`

## Supported tools

- `list-recorded-sessions`
- `get-session-flow-review`
- `get-session-generation-context`

## Integration principle

AIR MCP should feel editor-neutral:

- The user picks the IDE.
- The user picks the LLM provider.
- AIR still exposes the same tools through standard MCP transports.
- Host-specific config should stay thin and only provide command, args, and env.
