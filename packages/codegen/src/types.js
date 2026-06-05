"use strict";
/**
 * packages/codegen/src/types.ts
 *
 * Core type contracts for the AIR code generation package.
 *
 * These types define the "Semantic Timeline" — the compressed, intent-driven
 * representation of a recorded session that gets fed to the AI code generator
 * and stored as the .semantic.json blueprint alongside every generated test.
 *
 * Design principles:
 *   - No raw HTML, no DOM snapshots — AI context window is precious
 *   - Every step preserves WHY (intent) not just WHAT (selector)
 *   - Confidence + sampleSize tell the AI which steps are reliable
 *   - Assertions are split: AI-derived (from anchors) vs user-defined (stub)
 *   - The @air-step breadcrumb links generated code back to this blueprint
 *     enabling the future self-healing loop without schema changes
 */
Object.defineProperty(exports, "__esModule", { value: true });
