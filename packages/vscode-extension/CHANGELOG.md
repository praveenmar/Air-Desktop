# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

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
