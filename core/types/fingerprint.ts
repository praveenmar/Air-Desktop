// Purpose: Core types and schemas for DOM element identification (Fingerprints).
// Prototype Origin: types.js (SelectorPriority, ElementFingerprint)
// Changes: Converted to strict TypeScript with Zod validation.

import { z } from 'zod';

/** Selector priority (used by Interceptor when choosing selector) */
export const SelectorPrioritySchema = z.enum([
  'data-testid',
  'id',
  'class',
  'attribute',
  'path',
  'other',
  'text',     // Added based on event logs
  'xpath',    // Added based on event logs
  'chained'   // Added based on interceptor.js capabilities
]);
export type SelectorPriority = z.infer<typeof SelectorPrioritySchema>;

/** Contextual tags surrounding the element */
export const FingerprintContextSchema = z.object({
  parentTag: z.string().nullable(),
  nearestContainerTag: z.string().nullable(),
}).passthrough();
export type FingerprintContext = z.infer<typeof FingerprintContextSchema>;

export const SelectorAmbiguityMetadataSchema = z.object({
  originalSelector: z.string(),
  originalPriority: SelectorPrioritySchema.optional(),
  matchCount: z.number().int().min(0),
  visibleMatchCount: z.number().int().min(0),
  positionInMatches: z.number().int().min(0).nullable().optional(),
  isUnique: z.boolean(),
  isAmbiguous: z.boolean(),
}).passthrough();
export type SelectorAmbiguityMetadata = z.infer<typeof SelectorAmbiguityMetadataSchema>;

export const CapturedSelectorCandidateEngineSchema = z.enum([
  'css',
  'text',
  'xpath',
]);
export type CapturedSelectorCandidateEngine = z.infer<typeof CapturedSelectorCandidateEngineSchema>;

export const CapturedSelectorCandidateFamilySchema = z.enum([
  'primary',
  'test-id',
  'id',
  'name',
  'placeholder',
  'aria-label',
  'href',
  'role-attr',
  'text',
  'class',
  'parent-scoped-css',
  'tight-container-css',
]);
export type CapturedSelectorCandidateFamily = z.infer<typeof CapturedSelectorCandidateFamilySchema>;

export const CapturedSelectorCandidateStrengthSchema = z.enum([
  'strong',
  'medium',
  'weak',
]);
export type CapturedSelectorCandidateStrength = z.infer<typeof CapturedSelectorCandidateStrengthSchema>;

function normalizeWarningCodes(codes: string[]): string[] | undefined {
  const unique = Array.from(new Set(codes.map(code => code.trim()).filter(Boolean)));
  return unique.length > 0 ? unique : undefined;
}

export const CapturedSelectorCandidateSchema = z.object({
  selector: z.string().trim().min(1),
  engine: CapturedSelectorCandidateEngineSchema,
  family: CapturedSelectorCandidateFamilySchema,
  strength: CapturedSelectorCandidateStrengthSchema,
  source: z.literal('capture'),
  isPrimary: z.boolean().optional(),
  matchCount: z.number().int().min(0).nullable().optional(),
  visibleMatchCount: z.number().int().min(0).nullable().optional(),
  positionInAllMatches: z.number().int().min(0).nullable().optional(),
  positionInVisibleMatches: z.number().int().min(0).nullable().optional(),
  usesDynamicClass: z.boolean().optional(),
  usesIndex: z.boolean().optional(),
  warningCodes: z.array(z.string().trim().min(1)).optional().transform(codes => {
    if (!codes) return undefined;
    return normalizeWarningCodes(codes);
  }),
});
export type CapturedSelectorCandidate = z.infer<typeof CapturedSelectorCandidateSchema>;

export const CapturedSelectorCandidateArraySchema = z.array(z.unknown()).transform((entries) => {
  const valid: CapturedSelectorCandidate[] = [];
  for (const entry of entries) {
    const parsed = CapturedSelectorCandidateSchema.safeParse(entry);
    if (!parsed.success) continue;
    valid.push(parsed.data);
  }
  return valid.length > 0 ? valid : undefined;
});

export const BoundedContainerSelectorCandidateSchema = z.object({
  selector: z.string(),
  kind: z.string(),
  isClean: z.boolean().optional(),
}).passthrough();
export type BoundedContainerSelectorCandidate = z.infer<typeof BoundedContainerSelectorCandidateSchema>;

export const BoundedFieldContextSchema = z.object({
  fieldLabelText: z.string().nullable().optional(),
  fieldRelation: z.enum([
    'label-for',
    'wrapped-label',
    'aria-labelledby',
    'sibling-label',
    'bounded-container',
  ]).nullable().optional(),
  targetControlKind: z.enum([
    'input',
    'textarea',
    'select',
    'custom-trigger',
    'combobox',
    'searchbox',
    'contenteditable',
    'unknown',
  ]).nullable().optional(),
  visibleControlCountInContainer: z.number().int().min(0).nullable().optional(),
  targetIndexWithinContainer: z.number().int().min(0).nullable().optional(),
  boundedContainerSummary: z.string().nullable().optional(),
  boundedContainerSelectorCandidates: z.array(BoundedContainerSelectorCandidateSchema).optional(),
  cleanParentSelector: z.string().nullable().optional(),
  cleanChildSelector: z.string().nullable().optional(),
  containerSelector: z.string().nullable().optional(),
  competingControlCount: z.number().int().min(0).nullable().optional(),
  duplicateLabelCount: z.number().int().min(0).nullable().optional(),
  isValid: z.boolean().optional(),
  blockedReason: z.string().nullable().optional(),
}).passthrough();
export type BoundedFieldContext = z.infer<typeof BoundedFieldContextSchema>;

export const AccessibilityEvidenceSchema = z.object({
  role: z.string().nullable().optional(),
  accessibleName: z.string().nullable().optional(),
  accessibleNameSource: z.enum([
    'aria-label',
    'aria-labelledby',
    'label-for',
    'wrapped-label',
    'button-text',
    'link-text',
    'placeholder',
    'title',
    'role-text',
    'none',
  ]).optional(),
  labelText: z.string().nullable().optional(),
  labelledByIds: z.array(z.string()).optional(),
  isNativeLabelAssociation: z.boolean().optional(),
}).passthrough();
export type AccessibilityEvidence = z.infer<typeof AccessibilityEvidenceSchema>;

/** Compact fingerprint for an element (4-layer identification) */
export const ElementFingerprintSchema = z.object({
  selector: z.string(),
  selectorPriority: SelectorPrioritySchema,
  selectorRank: z.number().int().min(1).max(10).optional(),
  tagName: z.string().optional(),
  parentSelector: z.string().nullable().optional(),
  textExcerpt: z.string().nullable(),
  context: FingerprintContextSchema,
  attributes: z.record(z.string(), z.string().optional()),
  selectorCandidates: CapturedSelectorCandidateArraySchema.optional(),
  selectorAmbiguity: SelectorAmbiguityMetadataSchema.optional(),
  boundedFieldContext: BoundedFieldContextSchema.optional(),
  accessibilityEvidence: AccessibilityEvidenceSchema.optional(),
  attributesHash: z.string(),
}).passthrough();
export type ElementFingerprint = z.infer<typeof ElementFingerprintSchema>;
