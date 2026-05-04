import type {
  ActionType,
  ResolverMetadata,
  SelectorEngine,
  SelectorPriority,
  SelectorProofLevel,
  SelectorSource,
  SelectorSpec,
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
  locatorFlavor?: 'css' | 'text' | 'xpath' | 'playwright' | 'unknown';
  emittedLocator?: string;
  emittedLocatorEngine?: SelectorEngine | 'unknown';
  emittedLocatorProofLevel?: SelectorProofLevel | 'unknown';
  emittedLocatorSource?: SelectorSource | 'legacy-fallback' | 'unknown';
  emittedLocatorWarnings?: string[];
  usedSelectorSpec?: boolean;
}

export interface AirMetadata {
  version: 1;
  session: string;
  generatedAt: string;
  methods: Record<string, AirMethodMeta>;
}
