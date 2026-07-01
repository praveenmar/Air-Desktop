# AIR — AI Interaction Recorder

> Capture user interactions with rich context and empower AI coding assistants to generate accurate automation scripts.

![AIR Logo](images/logo.png)

## Overview

AIR (AI Interaction Recorder) is a VS Code extension designed for QA engineers, automation engineers, and developers.

Unlike traditional recorders that only capture selectors or XPath, AIR records the complete interaction context—including user intent, DOM relationships, metadata, and resilient locator evidence—allowing AI assistants to generate automation code that matches your existing framework and coding standards.

AIR acts as the missing bridge between browser interactions and AI-powered test automation.

---

## Why AIR?

Modern AI coding assistants are excellent at writing code—but they often lack the context needed to generate reliable automation scripts.

Instead of providing AI with only:

- XPath
- CSS Selector
- Element ID

AIR provides:

- User action
- Interaction sequence
- Element metadata
- DOM hierarchy
- Semantic information
- Resilient locator candidates
- Context around the interacted element

This enables AI to understand **what the user intended**, not just **what element was clicked**.

---

## Features

### Rich Interaction Recording

Capture user interactions including:

- Clicks
- Text input
- Keyboard actions
- Navigation
- Element focus
- Form interactions

---

### AI Context Generation

Generate rich contextual information for AI assistants.

Includes:

- Action intent
- Element metadata
- XPath
- CSS selectors
- DOM relationships
- Parent hierarchy
- Accessible attributes
- Locator candidates

---

### AI Assistant Support

Works with modern AI coding assistants including:

- GitHub Copilot
- Gemini
- Codex
- Claude Code
- Cursor
- Windsurf
- Cline
- Roo Code
- Continue
- Any AI-powered IDE supporting contextual prompts

---

### Framework-Aware Automation

Generate scripts for:

- Playwright
- Selenium
- Cypress
- WebdriverIO
- Puppeteer
- Robot Framework
- Custom automation frameworks

---

### Built for Existing Projects

AIR is designed to work with your existing automation framework.

Instead of generating generic code, it provides the AI with enough context to generate code that follows your team's:

- Page Object Model
- Naming conventions
- Locator strategy
- Helper methods
- Existing utilities
- Coding standards

---

## How It Works

```
User Interaction
        │
        ▼
AIR captures interaction
        │
        ▼
Context + Metadata + Locators
        │
        ▼
AI Assistant
(GitHub Copilot / Gemini / Codex)
        │
        ▼
Framework-aware Automation Script
```

---

## Installation

Install directly from the Visual Studio Marketplace.

1. Open VS Code
2. Go to Extensions
3. Search for **AIR**
4. Click **Install**

---

## Quick Start

1. Open your automation project.
2. Launch AIR.
3. Start recording interactions.
4. Perform actions in your browser.
5. Copy the generated interaction context.
6. Ask your preferred AI assistant to generate the automation script.

Example:

```
Generate a Playwright test using the following AIR interaction context.
Follow my existing Page Object Model framework.
```

The AI will generate automation code based on the recorded interaction and your existing project structure.

---

## Use Cases

- Generate Playwright tests
- Generate Selenium scripts
- Create Page Objects
- Generate locator methods
- Improve AI prompt quality
- Reduce manual automation coding
- Accelerate test development

---

## Why AIR is Different

Traditional Recorders:

- Record XPath
- Record CSS selectors
- Generate generic scripts

AIR:

- Understands interactions
- Preserves context
- Works with AI assistants
- Generates framework-aware automation
- Improves code quality
- Reduces prompt engineering effort

---

## Supported Platforms

- Visual Studio Code
- Windows
- macOS
- Linux

---

## Roadmap

Upcoming features include:

- Browser Extension
- Session Replay
- Smart Locator Healing
- AI Framework Learning
- Page Object Generation
- Team Convention Learning
- Visual Flow Analysis
- MCP Integration
- Multi-framework Export
- Cloud Sync (Optional)

---

## Feedback

Found a bug or have a feature request?

Please open an issue on GitHub.

We welcome feedback from the QA and automation community.

---

## License

MIT License

---

## About TestMasterHub

AIR is developed by **TestMasterHub**, a platform focused on AI-powered software testing and automation tools.

Learn more at:

https://testmasterhub.com

---

## Keywords

Playwright • Selenium • Cypress • QA Automation • AI • GitHub Copilot • Gemini • Codex • VS Code • Browser Automation • Test Automation • XPath • Locator • AI Coding Assistant • Automation Testing