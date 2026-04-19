import type { ActionType, ResolverMetadata, SelectorPriority } from './types';

export interface AirMethodMeta {
  step: number;
  intent: string;
  checksum: string;
  originalSelector: string;
  resolver?: ResolverMetadata;
  selectorUsed?: string;
  selectorType?: SelectorPriority;
  actionType?: ActionType;
  locatorFlavor?: 'css' | 'text' | 'xpath' | 'playwright' | 'unknown';
}

export interface AirMetadata {
  version: 1;
  session: string;
  generatedAt: string;
  methods: Record<string, AirMethodMeta>;
}
