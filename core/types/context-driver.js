"use strict";
// Purpose: Types for user intent and context tracking.
// Prototype Origin: types.js (SeekMethod, SeekMetadata, ContextDriver)
// Changes: Converted to Zod schemas and strict types.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextDriverSchema = exports.SeekStrategySchema = exports.SeekMethodSchema = void 0;
const zod_1 = require("zod");
/** Seek methods - how the user located the element */
exports.SeekMethodSchema = zod_1.z.enum([
    'scroll',
    'search',
    'filter',
    'history',
    'direct'
]);
/** Metadata describing the seek action (e.g., scroll distance, search term) */
exports.SeekStrategySchema = zod_1.z.object({
    method: exports.SeekMethodSchema.default('direct'),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}),
});
/** PRD's Context Driver for state differentiation */
exports.ContextDriverSchema = zod_1.z.object({
    text: zod_1.z.string().default(''),
    score: zod_1.z.number().default(0),
    position: zod_1.z.string().default('body'),
    semanticWeight: zod_1.z.number().default(0),
    historyWeight: zod_1.z.number().default(0),
    positionWeight: zod_1.z.number().default(0),
});
