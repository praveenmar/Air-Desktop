# AIR MCP Server

AIR MCP is the AIR v1 read surface for IDE LLMs.

In AIR v1:

- The VS Code extension records browser flows.
- AIR MCP reads recorded AIR sessions from the AIR database.
- AIR MCP exposes those sessions to MCP-compatible IDE hosts.
- AIR MCP is read-only.
- AIR MCP does not require the VS Code extension process to be running.

AIR should be consumable by any MCP-capable host, not only one IDE or one assistant.

## AIR MCP v1 purpose

AIR v1 splits responsibilities cleanly:

- VS Code extension: record flows into the AIR database
- AIR MCP server: read recorded sessions for LLM chat workflows
- IDE LLM host: call AIR tools and generate scripts or summaries

That means the normal user flow is:

1. Install the AIR VS Code extension.
2. Record a flow.
3. Configure AIR MCP in the IDE LLM host.
4. Ask the IDE LLM to read AIR sessions and generate code from them.

## Recommended host contract

Use one stable Node launcher instead of editor-specific `npx` or relative `tsx` commands.

- `command`: `node`
- `args`: `["/absolute/path/to/Air Desktop/scripts/air-mcp.cjs"]`
- `env.AIR_MCP_DB_PATH`: absolute path to the AIR SQLite database, if you do not pass `--db`

Why this contract is safer:

- It does not depend on the host process `cwd`.
- It does not depend on `npx` behavior.
- It works the same way across VS Code, Codex, Cursor, Antigravity, and other MCP hosts.
- The server path resolution stays inside the AIR repo.

## Build and verify

Build the AIR MCP dependency chain in order:

```bash
npm run build:mcp
```

Run the stdio launcher:

```bash
node scripts/air-mcp.cjs --db C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db
```

Expected good output:

```text
[AIR MCP] Server running on stdio
[AIR MCP] Database path: C:\Users\praveenmar\AppData\Roaming\air-desktop\air-data.db
```

### Verify built JS vs dev fallback

The launcher prefers built JS and only falls back to local `tsx` when the built entrypoint is missing.

If the launcher is using the dev fallback, it prints:

```text
[AIR MCP] Built entrypoint not found; using local tsx fallback for development only.
```

If you do not see that line, the launcher is using built JS.

If both `dist` and local `tsx` fallback are unavailable, the launcher fails with a clear error.

## MCP Inspector verification

You can verify the server outside any IDE host with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node scripts/air-mcp.cjs --db C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db
```

In Inspector, verify these tools:

- `list_recorded_sessions`
- `get_session_flow_review`
- `get_session_generation_context`

## Supported tools

AIR MCP v1 exposes these read-only tools:

- `list_recorded_sessions`
- `get_session_flow_review`
- `get_session_generation_context`

## Generic MCP stdio config

For IDE MCP hosts, prefer stdio mode.

Paths must be absolute.

Example:

```json
{
  "mcpServers": {
    "air": {
      "command": "node",
      "args": [
        "E:/Air Desktop/scripts/air-mcp.cjs",
        "--db",
        "C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db"
      ]
    }
  }
}
```

## Cursor config

Add an AIR MCP server in Cursor using the same `command` and `args` shape:

```json
{
  "mcpServers": {
    "air": {
      "command": "node",
      "args": [
        "E:/Air Desktop/scripts/air-mcp.cjs",
        "--db",
        "C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db"
      ]
    }
  }
}
```

If your Cursor version uses a settings UI instead of a JSON file, add the same values there.

## VS Code / Codex-style config

Use the MCP host’s config file or settings UI and add the `air` server with the same launcher contract:

```json
{
  "mcpServers": {
    "air": {
      "command": "node",
      "args": [
        "E:/Air Desktop/scripts/air-mcp.cjs",
        "--db",
        "C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db"
      ]
    }
  }
}
```

For Codex specifically, keep using the equivalent project or user config shape that points at the same launcher.

## Antigravity config

Configure Antigravity with the same stable stdio launcher contract:

```json
{
  "mcpServers": {
    "air": {
      "command": "node",
      "args": [
        "E:/Air Desktop/scripts/air-mcp.cjs",
        "--db",
        "C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db"
      ]
    }
  }
}
```

If Antigravity uses a settings UI rather than raw JSON, supply the same `node` command and absolute arguments there.

## Environment-variable option

If you prefer to keep the DB path out of `args`, use `env`:

```json
{
  "mcpServers": {
    "air": {
      "command": "node",
      "args": [
        "E:/Air Desktop/scripts/air-mcp.cjs"
      ],
      "env": {
        "AIR_MCP_DB_PATH": "C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db"
      }
    }
  }
}
```

DB path resolution order is:

1. `--db`
2. `AIR_MCP_DB_PATH`
3. `AIR_DB_PATH`
4. fail with a clear error

## Stdio mode

This is the default transport and is the right choice for IDE-integrated MCP clients.

Explicit command line:

```bash
node scripts/air-mcp.cjs --db C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db
```

Environment-based command line:

```bash
set AIR_MCP_DB_PATH=C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db
node scripts/air-mcp.cjs
```

## HTTP mode

Use HTTP mode only when a remote tool-calling runtime needs a network-reachable MCP endpoint.

This is not the normal IDE setup path.

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

- MCP: `http://127.0.0.1:3333/mcp`
- Health: `http://127.0.0.1:3333/health`

## IDE chat usage examples

Once the host is connected, try these prompts.

Session discovery:

```text
Use AIR MCP. Call list_recorded_sessions and show me the latest recorded sessions.
```

Flow review:

```text
Call get_session_flow_review for the latest session and summarize the recorded flow. Do not generate code yet.
```

Generation context:

```text
Call get_session_generation_context for this session.
```

Playwright generation:

```text
Read this repository’s Playwright framework structure.

Generate a Playwright test using the repo’s existing style.

Rules:
- Use GenerationContext.steps as the source of truth.
- Prefer resolvedTarget.value when locatorStatus is "resolved".
- Use resolvedTarget.kind to decide CSS vs XPath handling.
- Do not invent selectors.
- If a step is unresolved, use fallbackHints and add a TODO comment.
- Use safe mock data for <LLM_GENERATE_MOCK_DATA>.
- Add assertions from the assertions array.
```

## Troubleshooting

### Tools not visible in IDE

- Confirm the MCP server is enabled in the IDE host.
- Verify the host config points to `node` plus the absolute `scripts/air-mcp.cjs` path.
- Verify the host is loading the config file you edited.
- Use MCP Inspector first to confirm the server itself is healthy.

### DB path is wrong or no sessions are returned

- Make sure the AIR MCP config points to the same AIR DB the VS Code extension recorded into.
- Prefer passing `--db` explicitly until your environment is stable.
- If `list_recorded_sessions` returns nothing, double-check the DB file path first.

### Launcher falls back to tsx

- If you see:
  `[AIR MCP] Built entrypoint not found; using local tsx fallback for development only.`
- Run `npm run build:mcp`.
- Re-run the launcher and confirm that line is gone.

### Build output missing

- Run `npm run build:mcp`.
- Confirm these built package mains exist:
  - `packages/shared/dist/index.js`
  - `packages/codegen/dist/index.js`
  - `packages/mcp-server/dist/index.js`

### Windows path contains spaces

- Use absolute paths.
- Keep the path as a single string entry in the host config.
- Example:
  `E:/Air Desktop/scripts/air-mcp.cjs`

### HTTP vs stdio confusion

- Use stdio for IDE MCP hosts.
- Use HTTP only for remote or networked tool-calling runtimes.
- If you run HTTP mode in a terminal, it stays alive because it is a server process.

### Extension recorded data into a different DB than MCP is reading

- This is the most common AIR v1 mismatch.
- The VS Code extension and AIR MCP must point to the same database file.
- If recording works but MCP returns empty sessions, compare both DB paths explicitly.

## Integration principle

AIR MCP should feel editor-neutral:

- The user picks the IDE.
- The user picks the LLM provider.
- AIR still exposes the same tools through standard MCP transports.
- Host-specific config should stay thin and only provide command, args, and env.
