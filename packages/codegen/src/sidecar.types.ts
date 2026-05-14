import type {
  ActionType,
  BoundedFieldControlKind,
  BoundedFieldRelation,
  BoundedFieldSelectorSpec,
  EquivalentRendering,
  LabelContextRenderStatus,
  LabelContextSelectorSpec,
  TriggerContextSelectorSpec,
  ResolverMetadata,
  SelectorEngine,
  SelectorPriority,
  SelectorProofLevel,
  SelectorSource,
  SelectorSpec,
  PlaywrightNativeCandidateReportEntry,
} from './types';

export interface AirMethodMeta {
  step: number;
  intent: string;
  checksum: string;
  originalSelector: string;
  originalSelectorSpec?: SelectorSpec;
  resolver?: ResolverMetadata;
  selectorUsed?: string;
  resolvedSelectorSpec?: SelectorSpec;
  selectorType?: SelectorPriority;
  actionType?: ActionType;
  fieldLabelText?: string;
  locatorFlavor?: 'css' | 'text' | 'xpath' | 'playwright' | 'unknown';
  emittedLocator?: string;
  emittedLocatorEngine?: SelectorEngine | 'unknown';
  emittedLocatorProofLevel?: SelectorProofLevel | 'unknown';
  emittedLocatorSource?: SelectorSource | 'legacy-fallback' | 'unknown';
  emittedLocatorWarnings?: string[];
  usedSelectorSpec?: boolean;
  controlFamily?: string;
  triggerOriginalSelector?: string;
  triggerFieldLabelText?: string;
  triggerSelector?: string;
  triggerSelectorPriority?: SelectorPriority;
  triggerResolvedSelector?: string;
  triggerSelectorSpec?: SelectorSpec;
  triggerContextProof?: TriggerContextSelectorSpec;
  triggerContextLabel?: string;
  triggerContextRenderStatus?: LabelContextRenderStatus;
  triggerContextRenderReason?: string;
  triggerBoundedContainerSummary?: string;
  triggerStructuralFallbackLocator?: string;
  triggerWarningCodes?: string[];
  boundedFieldProof?: BoundedFieldSelectorSpec;
  boundedFieldLabelText?: string;
  boundedFieldRelation?: BoundedFieldRelation;
  boundedFieldControlKind?: BoundedFieldControlKind;
  boundedFieldRenderStatus?: LabelContextRenderStatus;
  boundedFieldRenderReason?: string;
  boundedFieldOriginalSelector?: string;
  boundedFieldTargetSelectorSpec?: SelectorSpec;
  boundedFieldMatchedContainerSummary?: string;
  boundedFieldWarningCodes?: string[];
  boundedFieldRejectReason?: string;
  optionSelector?: string;
  optionText?: string;
  optionValue?: string;
  optionResolvedSelector?: string;
  optionSelectorSpec?: SelectorSpec;
  absorbedOpenEventId?: string;
  absorbedOpenTraceId?: string;
  compressedFromEvents?: string[];
  equivalentRenderingUsed?: boolean;
  equivalentLocator?: string;
  equivalentLocatorEngine?: EquivalentRendering['engine'] | 'unknown';
  equivalentProofLevel?: EquivalentRendering['proofLevel'] | 'unknown';
  equivalentProofSource?: EquivalentRendering['proofSource'] | 'unknown';
  equivalentSourceSelector?: string;
  preferredRenderings?: EquivalentRendering[];
  labelContextProof?: LabelContextSelectorSpec;
  labelContextRenderStatus?: LabelContextRenderStatus;
  labelContextRenderReason?: string;
  labelText?: string;
  relationType?: LabelContextSelectorSpec['association'];
  boundedContainerSummary?: string;
  cleanParentSelector?: string;
  cleanChildSelector?: string;
  structuralFallbackLocator?: string;
  recoveredFromSelector?: string;
  warningCodes?: string[];
  playwrightNativeCandidates?: PlaywrightNativeCandidateReportEntry[];
}

export interface AirMetadata {
  version: 1;
  session: string;
  generatedAt: string;
  methods: Record<string, AirMethodMeta>;
}
