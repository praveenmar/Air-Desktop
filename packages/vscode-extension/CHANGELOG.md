# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

---

# AIR v0.1.6 - Session Loading Fixes & Improvements

## Bug Fixes

- Fixed AIR Developer Console session loading so the Inspector no longer remains stuck on "Loading snapshot..." when selecting a recorded session.
- Improved Developer Console startup behavior by initializing the VS Code message bridge before tab scripts run.

## Improvements

- Updated documentation to highlight VirusTotal verification.
- Clarified supported AI coding tools and AIR MCP compatibility in the README.

---

# 🚀 AIR v0.1.5 — Bug fixes

# 🐞 Bug Fixes

Fixed all known bugs and improved DOM & Intent capturing

---

# 🚀 AIR v0.1.4 — Major UI Upgrade & Smarter Recording Engine

> **A major release focused on improving the developer experience with a redesigned UI, enhanced session management, a brand-new Developer Console, and significant backend improvements for AI-powered Playwright generation.**

---

## ✨ What's New

### 🎨 Major UI Upgrade

AIR now provides a modern, intuitive workflow directly inside VS Code, replacing the previous command-centric experience with dedicated controls and powerful management tools.

---

## 🚀 New Status Bar Controls

Access AIR without opening the Command Palette.

### Added

- ▶️ **AIR Start** — Start recording instantly.
- ⏹️ **AIR Stop** — Stop active recording sessions.
- 🕘 **AIR History** — Open Session History with one click.

**Benefits**

- Faster workflow
- Less context switching
- Better VS Code integration
- Improved developer experience

---

# 📋 Enhanced Session History

The previous Session History displayed only a simple list of Session IDs.

It has now been completely redesigned into a full-featured Session Manager.

### New Features

- 🔍 Search by Session ID
- 🎯 Filter by Session Status
- ↕️ Sort sessions (Newest / Oldest)
- 📄 One-click Copy Session ID
- 🗑 Delete individual sessions
- 🔄 Refresh sessions instantly
- 🟢 Active / Ended status indicators
- Cleaner and modern UI

### Improvements

- Better session organization
- Faster navigation
- Easier session management
- Simplified cleanup of old recordings

---

# 🛠 New AIR Developer Console

Introducing the **AIR Developer Console** — a dedicated workspace for inspecting recorded sessions and debugging AI workflows.

## Features

### 🔎 Inspector

- Inspect recorded snapshots
- View captured DOM metadata
- Explore interaction context

### ⚡ Events

- Stream browser interaction events
- Review recorded actions
- Inspect event timelines

### 📜 Logs

- Review recording lifecycle
- Debug extension behavior
- Analyze recording execution

### 🤖 MCP

- Inspect MCP configuration
- Debug MCP communication
- Validate AI integration

### Additional Tools

- Copy JSON
- Refresh Sessions
- Snapshot Search
- Session Selector

---

# 🤖 AI & MCP Improvements

Significant improvements have been made to AIR's AI communication layer.

### Improvements

- Fixed JSON stream corruption during MCP communication.
- Eliminated intermittent failures with AI-powered IDEs.
- Improved communication reliability with Cursor, Windsurf, and other MCP-compatible editors.
- Enhanced AI context extraction.
- Improved prompt quality sent to AI models.
- Increased stability of AI-assisted code generation.

### Result

✅ More reliable

✅ Better AI responses

✅ Stable Playwright generation

---

# 🎯 Smarter Playwright Locator Generation

The selector engine has been completely redesigned.

Instead of relying primarily on brittle selectors, AIR now generates more semantic and resilient Playwright locators.

### Improvements

Prioritizes:

- `getByRole()`
- `getByText()`
- `getByLabel()`
- Semantic accessibility attributes

Reduced reliance on:

- XPath
- Complex CSS selectors
- Fragile DOM paths

### Benefits

- Cleaner Playwright scripts
- Better readability
- Higher resilience to UI changes
- Improved long-term maintainability

---

# 🧠 Intelligent Element Resolution

AIR now understands user interactions more accurately.

### Improvements

- Re-engineered canonical element resolution.
- Automatically maps `<label>` interactions to their associated form controls.
- Eliminates duplicate interactions in generated scripts.
- Improved handling of nested containers.
- Fixed null-reference issues during interaction recording.

### Result

Cleaner generated automation with fewer redundant actions.

---

# ⚙️ Recording Engine Improvements

The recording engine has been enhanced to produce higher-quality snapshots.

### Improvements

- Waits for DOM stability before capturing interactions.
- Waits for network quiescence.
- Improved browser lifecycle management.
- Reduced incomplete or noisy recordings.
- Improved snapshot timing accuracy.

### Benefits

- More accurate recordings
- Better replay reliability
- Improved AI understanding

---

# 🧩 Richer AI Context

AIR now captures significantly more contextual information during recording.

### Enhanced Context Includes

- Rich DOM metadata
- Accessibility information
- Interaction hierarchy
- Element relationships
- Semantic context

This enables AI models to generate smarter and more context-aware automation scripts.

---

# ⚡ Performance Improvements

- Faster recording workflow
- Improved session lifecycle management
- Better internal extraction logic
- Enhanced user intent tracking
- Improved extension responsiveness
- Reduced processing overhead

---

# 🛠 Stability Improvements

- Improved browser lifecycle handling
- Better error recovery
- Enhanced extension reliability
- Improved recording consistency
- Better session persistence

---

# 🐞 Bug Fixes

- Fixed multiple recording workflow issues.
- Fixed MCP JSON communication corruption.
- Fixed session management inconsistencies.
- Fixed UI consistency issues.
- Fixed nested container interaction issues.
- Fixed duplicate `<label>` interaction generation.
- Fixed AI code generation failures.
- Resolved several known issues.
- General bug fixes and performance improvements.

---

# 📈 Release Highlights

| Area | Improvements |
|-------|--------------|
| 🎨 UI | Major UI redesign |
| 📋 Session History | Completely redesigned |
| 🛠 Developer Console | New feature |
| 🤖 AI Integration | More reliable |
| 🎯 Locator Engine | Smarter Playwright locators |
| 🧠 Context Extraction | Richer DOM metadata |
| ⚙ Recording Engine | Improved stability |
| 🚀 Performance | Faster workflow |
| 🐞 Bug Fixes | Multiple fixes & stability improvements |

---

## ❤️ Thank You

Thank you for using **AIR**!

This release represents a significant step toward making AIR the most intelligent and developer-friendly AI-powered browser automation recorder inside VS Code.

Stay tuned—more exciting AI capabilities and developer productivity features are coming soon! 🚀
---

## [0.1.3] - 2026-07-04

### Fixed

- Fixed an issue where multiple elements could resolve to the same selector.
- Selector logic improvements for more reliable, unique element targeting.

---

## [0.1.2] - 2026-07-03

### ✨ Major UI Upgrade

AIR now introduces a modern visual workflow inside VS Code, replacing the previous command-centric experience.

### Added

- New Status Bar controls for quick access.
- AIR Start button.
- AIR Stop button.
- AIR History button.
- Dedicated Session History webview.
- One-click Copy Session ID action.
- Session status indicators (Active / Ended).
- Refresh option inside Session History.

### Improved

- Eliminated the need to use Command Palette for everyday operations.
- Faster recording workflow.
- Cleaner developer experience.
- Better session management.
- Improved VS Code integration.
- Updated extension documentation.
- Updated Marketplace presentation.

### Fixed

- Fixed multiple recording workflow issues.
- Fixed session handling improvements.
- Fixed UI consistency issues.
- Improved browser lifecycle handling.
- Improved extension stability.
- General bug fixes and performance improvements.

---

## [0.1.0] - 2026-07-02

### 🎉 Initial Release

AIR (AI Intent Runtime) is an AI-powered browser and VS Code extension that captures rich user interaction context and provides it to AI coding assistants for generating high-quality automation scripts.

### Added

- Initial release of the AIR VS Code extension.
- AI Intent Runtime for web application automation.
- Capture user interaction context.
- Capture element metadata and DOM relationships.
- Generate resilient XPath and locator information.
- Context-aware interaction recording for AI assistants.
- Seamless integration with AI coding assistants including:
  - GitHub Copilot
  - Gemini
  - Codex
  - Claude Code
  - Cursor
  - Windsurf
  - Cline
  - Roo Code
  - Other AI-powered IDEs
- Framework-aware context generation to help AI produce automation scripts that match existing project structures.
- Lightweight extension with minimal developer setup.
- Modern UI with developer-focused workflow.
- Cross-project support for automation development.

### Supported Automation Frameworks

- Playwright
- Selenium
- Cypress
- WebdriverIO
- Puppeteer
- Robot Framework
- Custom automation frameworks

### Notes

This is the first public release of AIR.

Future releases will introduce additional capabilities including:

- Browser Extension integration
- Automatic Page Object Model generation
- Smart selector healing
- Session replay
- AI-powered framework learning
- MCP integration
- Team convention learning
- Visual flow analysis
- Enhanced code generation
