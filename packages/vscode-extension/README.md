# AIR (AI Interaction Recorder)

> Record browser interactions, capture rich automation context, and generate reliable AI-powered automation scripts for your existing test framework.

![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue)
![Beta](https://img.shields.io/badge/Status-Beta-red)
![License](https://img.shields.io/badge/License-MIT-green)
![Playwright](https://img.shields.io/badge/Playwright-Supported-brightgreen)
![Selenium](https://img.shields.io/badge/Selenium-Supported-success)
![AI Ready](https://img.shields.io/badge/AI-Ready-orange)

---

# Overview

AIR (AI Interaction Recorder) is a Visual Studio Code extension that bridges the gap between browser interactions and AI-powered automation development.

Instead of recording only selectors or generating generic scripts, AIR captures the complete interaction context—including user actions, DOM relationships, semantic information, resilient locators, and metadata—allowing AI coding assistants to generate high-quality automation code that matches your existing project.

Whether you're using Playwright, Selenium, Cypress, or a custom automation framework, AIR provides the context AI needs to generate maintainable and reliable test automation.

---

# 🔌 MCP Server Setup (AIR MCP)

AIR also ships an MCP (Model Context Protocol) server — **`air-mcp-server`** — so any MCP-compatible AI coding assistant can pull session context directly, without you copy-pasting anything.

Below are verified setup steps for the most common VS Code AI agents. For any other agent, or if these steps ever change, check the always-up-to-date guide here:

👉 **https://air.testmasterhub.com/resources/mcp-setup-guide**

The core config block is the same everywhere — only the file location and the way you open it changes:

```json
{
  "mcpServers": {
    "testmasterhub_airmcp": {
      "command": "npx",
      "args": ["-y", "air-mcp-server"],
      "disabled": true
    }
  }
}
```

> Note: `"disabled": true` is intentional — you enable/start the server from each tool's UI after adding it (steps below), rather than having it auto-start.

---

## 🧩 GitHub Copilot (Default, VS Code)

1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac) to open the Command Palette.
2. Type and select **`MCP: List Servers`**.
3. Click **`+ Add Server`** (or run `MCP: Add Server` from the palette).
4. Choose **`Command (stdio)`** as the server type.
5. Paste the config block when prompted, or if it opens a raw `mcp.json`, paste it directly:
   ```json
   {
     "servers": {
       "testmasterhub_airmcp": {
         "command": "npx",
         "args": ["-y", "air-mcp-server"]
       }
     }
   }
   ```
   (VS Code's own `mcp.json` schema uses the key `"servers"`, not `"mcpServers"`.)
6. Press Enter / save the file.
7. Open the **Extensions** view (`Ctrl+Shift+X`). Under **Installed**, find **MCP Servers** → **testmasterhub_airmcp**.
8. Click the gear/settings icon next to it → **Start Server**.
9. To confirm the connection, open Copilot Chat (Agent mode) and ask: *"Check AIR MCP connection."*

---

## 🧩 Gemini (Gemini Code Assist, VS Code)

Gemini Code Assist doesn't have a command-palette install flow for MCP — servers are added by editing a settings file directly.

1. Make sure you're on **Agent mode** in the Gemini Code Assist chat panel (agent mode is required for MCP).
2. Open (or create) your Gemini settings file:
   - **Global (all projects):** `~/.gemini/settings.json` (Mac/Linux) or `%USERPROFILE%\.gemini\settings.json` (Windows)
   - **Per-project:** `.gemini/settings.json` in your project root
3. Add the server config (Gemini uses the same `mcpServers` key):
   ```json
   {
     "mcpServers": {
       "testmasterhub_airmcp": {
         "command": "npx",
         "args": ["-y", "air-mcp-server"]
       }
     }
   }
   ```
4. Save the file, then reload the VS Code window (`Ctrl+Shift+P` → **Developer: Reload Window**).
5. In the Gemini Code Assist chat, switch to the **Agent** tab and type `/mcp` to confirm `testmasterhub_airmcp` is listed and connected.
6. To confirm the connection, ask: *"Check AIR MCP connection."*

---

## 🧩 Claude Code (VS Code Extension / CLI)

Claude Code has its own CLI command for adding MCP servers — no manual JSON editing required.

1. Open the integrated terminal in VS Code (with the Claude Code extension installed).
2. Run:
   ```bash
   claude mcp add testmasterhub_airmcp -- npx -y air-mcp-server
   ```
   - Use `--scope project` instead if you want it committed to `.mcp.json` and shared with your team:
     ```bash
     claude mcp add --scope project testmasterhub_airmcp -- npx -y air-mcp-server
     ```
3. Verify it was added:
   ```bash
   claude mcp list
   ```
4. Inside a Claude Code session, run `/mcp` and select `testmasterhub_airmcp` to see its available tools and confirm it's connected.
5. To confirm the connection, ask Claude Code: *"Check AIR MCP connection."*

---

## 🧩 Cursor

1. Open **Cursor Settings** (`Cmd/Ctrl + ,`) → **Tools & MCP** (or **Features → MCP** on older versions).
2. Click **`+ Add new MCP server`**.
3. Fill in:
   - **Name:** `testmasterhub_airmcp`
   - **Type:** `command` / `stdio`
   - **Command:** `npx -y air-mcp-server`
4. Click **Install**, then fully restart Cursor.

   Alternatively, edit the config file directly:
   - **Global:** `~/.cursor/mcp.json`
   - **Project:** `<project-root>/.cursor/mcp.json`
   ```json
   {
     "mcpServers": {
       "testmasterhub_airmcp": {
         "command": "npx",
         "args": ["-y", "air-mcp-server"]
       }
     }
   }
   ```
5. Open the Cursor chat (`Cmd/Ctrl + L`), switch to **Agent**, and ask: *"Check AIR MCP connection."*

---

## 🧩 Windsurf (Cascade)

1. Click the **MCPs icon** in the top-right of the Cascade panel (or go to **Windsurf Settings → Advanced Settings → Cascade** and enable MCP if it isn't already).
2. Click **Configure** to open `~/.codeium/windsurf/mcp_config.json` (create the file if it doesn't exist).
3. Add:
   ```json
   {
     "mcpServers": {
       "testmasterhub_airmcp": {
         "command": "npx",
         "args": ["-y", "air-mcp-server"]
       }
     }
   }
   ```
4. Save the file, then click **Refresh** (🔄) in the MCP toolbar.
5. In Cascade chat, ask: *"Check AIR MCP connection."*

---

## 🧩 Cline

1. Open the Cline panel in VS Code and click the **MCP Servers** icon.
2. Click **Configure MCP Servers** — this opens `cline_mcp_settings.json`.
3. Add the server under `mcpServers`:
   ```json
   {
     "mcpServers": {
       "testmasterhub_airmcp": {
         "command": "npx",
         "args": ["-y", "air-mcp-server"],
         "disabled": false,
         "autoApprove": []
       }
     }
   }
   ```
4. Save the file — Cline detects the change and starts the server automatically.
5. In the Cline chat, ask: *"Check AIR MCP connection."*

---

## 🧩 Roo Code

1. Open the Roo Code panel in VS Code and click the **MCP Servers** icon (two stacked server drives).
2. Click **Edit Global MCP** (available in every project) or **Edit Project MCP** (`.roo/mcp.json`, current project only).
3. Add the server under `mcpServers`:
   ```json
   {
     "mcpServers": {
       "testmasterhub_airmcp": {
         "command": "npx",
         "args": ["-y", "air-mcp-server"]
       }
     }
   }
   ```
4. Save the file. Make sure **Enable MCP Servers** is toggled on in the MCP settings panel, then toggle `testmasterhub_airmcp` on if it isn't running.
5. In the Roo Code chat, ask: *"Check AIR MCP connection."*

---

## 🧩 Other Agents (Continue, Codex, custom MCP clients, etc.)

Any MCP-compatible client accepts the same `mcpServers` block shown at the top of this section — only the config file location and the UI for opening it differ per tool.

For step-by-step instructions covering additional agents, updates to the steps above, and troubleshooting, see the full guide:

👉 **https://air.testmasterhub.com/resources/mcp-setup-guide**

---

# ✨ What's New

AIR now features a modern, developer-friendly interface directly inside VS Code.

No more remembering commands or navigating the Command Palette.

Everything you need is available from the VS Code Status Bar.

### New Visual Workflow

- 🎥 AIR Start
- ⏹ AIR Stop
- 📂 AIR History

Manage your recording sessions with a single click.

---

# Why AIR?

Traditional automation recorders typically generate:

- XPath
- CSS Selectors
- Generic automation code

Unfortunately, modern AI assistants need much more context to generate production-ready automation.

AIR captures:

- User intent
- Interaction sequence
- Semantic element information
- DOM hierarchy
- Parent-child relationships
- Multiple locator strategies
- Accessible metadata
- Rich contextual information

This allows AI assistants to understand **what happened**, not just **which element was clicked**.

---

# Features

## 🎥 One-Click Recording

Start recording directly from the VS Code Status Bar.

No Command Palette required.

Features include:

- Launch browser automatically
- Start recording with one click
- Stop recording instantly
- Capture complete user interaction flow
- Automatic session creation

---

## 📂 Session History

View all recorded sessions from an integrated History panel.

The Session History UI provides:

- Complete recording history
- Active and completed session status
- Session timestamps
- Refresh recordings
- One-click Session ID copy

No terminal commands required.

---

## 📋 One-Click Session ID Copy

Each recorded session includes a built-in Copy button.

Simply copy the Session ID and use it with:

- GitHub Copilot
- Claude Code
- Gemini
- Cursor
- Windsurf
- Roo Code
- Cline
- Codex
- AIR MCP Server

---

## 🤖 Rich AI Context Generation

AIR records much more than browser clicks.

Each interaction includes:

- User action
- User intent
- DOM hierarchy
- Semantic metadata
- Element attributes
- XPath
- CSS Selectors
- Locator candidates
- Accessible information
- Parent relationships
- Neighboring elements

The result is significantly better automation generated by AI assistants.

---

## 🧠 AI Assistant Support

AIR works with all major AI coding assistants.

Supported AI tools include:

- GitHub Copilot
- Claude Code
- Gemini
- Cursor
- Windsurf
- Roo Code
- Continue
- Cline
- Codex
- Any MCP-compatible AI assistant

---

## 🚀 Framework-Aware Automation

Generate automation for:

- Playwright
- Selenium
- Cypress
- Puppeteer
- WebdriverIO
- Robot Framework
- Appium
- Custom automation frameworks

AIR provides framework-aware context instead of generic automation scripts.

---

## 🏗 Built for Existing Projects

AIR does not force a new framework.

Instead, it helps AI generate automation that follows your existing project structure.

Examples include:

- Page Object Model
- Helper methods
- Existing utilities
- Locator strategy
- Naming conventions
- Team coding standards

---

## ⚡ Lightweight & Fast

AIR is designed for everyday development.

- Minimal setup
- Fast startup
- Lightweight runtime
- Native VS Code experience
- Modern UI
- Cross-platform support

---

# Quick Start

## Step 1 — Install AIR

Install AIR directly from the Visual Studio Marketplace.

---

## Step 2 — Open Your Automation Project

Open any existing automation project in VS Code.

Supports:

- Playwright
- Selenium
- Cypress
- WebdriverIO
- Puppeteer
- Robot Framework

---

## Step 3 — Start Recording

Click

**🎥 AIR Start**

from the VS Code Status Bar.

AIR will:

- Launch a browser
- Create a recording session
- Begin capturing interactions

---

## Step 4 — Perform Browser Actions

Interact with your application normally.

AIR automatically records:

- Mouse clicks
- Keyboard input
- Form interactions
- Navigation
- Focus events
- DOM metadata
- Locator information
- Semantic context

---

## Step 5 — Stop Recording

Click

**⏹ AIR Stop**

to finish the recording.

AIR safely saves the session.

---

## Step 6 — Open Session History

Click

**📂 AIR History**

Browse all recorded sessions.

Features include:

- Session status
- Recording timestamps
- Copy Session ID
- Refresh recordings

---

## Step 7 — Generate Automation

Copy the Session ID and ask your preferred AI assistant.

Example:

```
Generate a Playwright test using AIR Session:

<session-id>

Follow my existing Page Object Model architecture.

Reuse existing helper methods.

Generate maintainable automation code.
```

AIR provides the AI with the required interaction context for accurate automation generation.

---

# Typical Workflow

```
Developer
      │
      ▼
Click AIR Start
      │
      ▼
Perform Browser Actions
      │
      ▼
Click AIR Stop
      │
      ▼
Open AIR History
      │
      ▼
Copy Session ID
      │
      ▼
Ask AI Assistant
      │
      ▼
Production-Ready Automation Code
```

---

# Supported Frameworks

- Playwright
- Selenium
- Cypress
- Puppeteer
- WebdriverIO
- Robot Framework
- Appium
- Custom Frameworks

---

# Supported AI Assistants

- GitHub Copilot
- Claude Code
- Gemini
- Cursor
- Windsurf
- Roo Code
- Continue
- Cline
- Codex
- AIR MCP

---

# Use Cases

AIR is perfect for:

- Creating Playwright tests
- Creating Selenium scripts
- Creating Cypress automation
- Generating Page Objects
- Building reusable locator methods
- Improving AI prompts
- Learning existing automation frameworks
- Accelerating QA automation development

---

# Why Developers Love AIR

✅ One-click recording

✅ Rich AI context

✅ Modern VS Code UI

✅ Session History

✅ Copy Session IDs instantly

✅ Works with existing projects

✅ Framework-aware automation

✅ AI-ready interaction recording

✅ No vendor lock-in

---

# Roadmap

Upcoming features include:

- Browser Extension
- Automatic Page Object generation
- AI-powered locator healing
- Session Replay
- Visual Flow Viewer
- Team Convention Learning
- Multi-session comparison
- Smart Assertions
- MCP Enhancements
- Cloud Sync (Optional)
- Multi-browser recording
- Advanced filtering

---

# Feedback

Found a bug?

Have a feature request?

We'd love to hear from you.

Please open an issue on our GitHub repository.

---

# License

MIT License

---

# About TestMasterHub

AIR is developed by **TestMasterHub**, focused on building AI-powered software testing and automation tools that help developers and QA engineers build better automation faster.

Website:

https://testmasterhub.com

https://air.testmasterhub.com/

---

# Keywords

AI • Playwright • Selenium • Cypress • Test Automation • QA Automation • Browser Recorder • VS Code Extension • GitHub Copilot • Claude Code • Gemini • Cursor • MCP • Automation Testing • XPath • CSS Selector • DOM Recorder • AI Automation • Page Object Model