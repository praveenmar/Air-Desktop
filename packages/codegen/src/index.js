"use strict";
/**
 * packages/codegen/src/index.ts
 * Public API of the @air/codegen package.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasUserAssertionSupport = exports.getUserDefinedAssertions = exports.FlowReviewFormatter = exports.FlowReviewService = exports.selectSnapshotForStep = exports.selectSnapshotForOutcome = exports.selectSnapshotForAction = exports.resolveSelectorsForSession = exports.CodegenService = void 0;
// ── Core pipeline ────────────────────────────────────────────────────────────
var codegen_service_1 = require("./codegen.service");
Object.defineProperty(exports, "CodegenService", { enumerable: true, get: function () { return codegen_service_1.CodegenService; } });
var selector_resolver_1 = require("./selector-resolver");
Object.defineProperty(exports, "resolveSelectorsForSession", { enumerable: true, get: function () { return selector_resolver_1.resolveSelectorsForSession; } });
var snapshot_selector_1 = require("./snapshot-selector");
Object.defineProperty(exports, "selectSnapshotForAction", { enumerable: true, get: function () { return snapshot_selector_1.selectSnapshotForAction; } });
Object.defineProperty(exports, "selectSnapshotForOutcome", { enumerable: true, get: function () { return snapshot_selector_1.selectSnapshotForOutcome; } });
Object.defineProperty(exports, "selectSnapshotForStep", { enumerable: true, get: function () { return snapshot_selector_1.selectSnapshotForStep; } });
// ── FlowReview layer ─────────────────────────────────────────────────────────
var flow_review_service_1 = require("./flow-review.service");
Object.defineProperty(exports, "FlowReviewService", { enumerable: true, get: function () { return flow_review_service_1.FlowReviewService; } });
var flow_review_formatter_1 = require("./flow-review.formatter");
Object.defineProperty(exports, "FlowReviewFormatter", { enumerable: true, get: function () { return flow_review_formatter_1.FlowReviewFormatter; } });
// ── Stubs ────────────────────────────────────────────────────────────────────
var assertion_stub_1 = require("./assertion.stub");
Object.defineProperty(exports, "getUserDefinedAssertions", { enumerable: true, get: function () { return assertion_stub_1.getUserDefinedAssertions; } });
Object.defineProperty(exports, "hasUserAssertionSupport", { enumerable: true, get: function () { return assertion_stub_1.hasUserAssertionSupport; } });
