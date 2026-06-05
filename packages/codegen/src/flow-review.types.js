"use strict";
/**
 * packages/codegen/src/flow-review.types.ts
 *
 * Data contracts for the FlowReview presentation layer.
 *
 * FlowReview is a fully enriched DTO derived from CodegenSession.
 * It contains no raw graph data (no HTML, no DB references).
 * It is designed to be consumed by:
 *   - The Electron renderer UI (session review screen)
 *   - FlowReviewFormatter (CLI / console output)
 *   - Future: MCP tool response payload
 */
Object.defineProperty(exports, "__esModule", { value: true });
