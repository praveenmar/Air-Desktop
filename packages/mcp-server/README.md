# AIR MCP Server

The **AIR MCP Server** (Model Context Protocol) provides AI agents (like Claude Desktop, Gemini, or Cline) with deterministic, semantic access to your web automation recordings.

It acts as the intelligent bridge between the [AIR VS Code Extension]https://marketplace.visualstudio.com/items?itemName=TestMasterHubAI.AIRAIInteractionRecorder and your LLMs, allowing AI to review user flows,intent, extract resilient locators, and generate Playwright tests with minimal effort to no effort.

---

## 🚀 Quick Start (Zero Installation)

If you have the AIR VS Code Extension installed and have recorded a session, you do **not** need to install this package manually. 

You can connect your AI directly using `npx`. Just add this configuration to your MCP client:

### Claude Desktop Configuration
Open your `claude_desktop_config.json` (or your chosen MCP client's config file) and add:

```json
{
  "mcpServers": {
    "air-desktop": {
      "command": "npx",
      "args": [
        "-y",
        "air-mcp-server@latest"
      ]
    }
  }
}
```
*Note for Windows users: Depending on your terminal environment, you may need to use `"npx.cmd"` instead of `"npx"`.*

Restart Claude Desktop, and your AI will immediately have access to your AIR recordings!

---

## 🛠️ Requirements

- **Node.js 22 or higher** (Required for native `node:sqlite` database support).
- Sessions recorded via the **AIR VS Code Extension**.

---

## 🧠 Capabilities (MCP Tools)

This server exposes powerful tools directly to the LLM:

1. **`list_recorded_sessions`**
   - Retrieves all sessions recorded locally on your machine.
   - LLMs use this to discover what web flows you have automated.

2. **`get_session_flow_review`**
   - Generates a human-readable summary of a specific session.
   - Provides the AI with the overarching "intent" of the recording, the sequence of pages visited, and any warnings (like user interventions or assertions).

3. **`get_session_generation_context`**
   - The core engine for test generation. 
   - Retrieves the machine-readable "AIR Selector Proof Packets" for every step in the session. This provides the LLM with the deterministic data needed to write resilient, self-healing Playwright scripts.

---

## ⚙️ Advanced: Custom Database Paths

By default, the server reads the recording database from your unified AIR home directory (`~/.air/air-data.db`). 

If you are running in a CI/CD environment or need to point to a specific database file, you can override this by passing the `--db` flag:

```json
{
  "mcpServers": {
    "air-desktop": {
      "command": "npx",
      "args": [
        "-y",
        "air-mcp-server@latest",
        "--db",
        "/absolute/path/to/custom-air-data.db"
      ]
    }
  }
}
```

---

## 📖 About AIR (Autonomous Interaction Recorder)

AIR is designed to bridge the gap between human intent and deterministic web automation. By capturing semantic state changes rather than brittle XPaths, AIR ensures your UI tests remain resilient across app updates.


