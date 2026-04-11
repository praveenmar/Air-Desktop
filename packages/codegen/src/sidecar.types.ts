import type { ResolverMetadata } from './types';

export interface AirMethodMeta {
  step: number;
  intent: string;
  checksum: string;
  originalSelector: string;
  resolver?: ResolverMetadata;
}

export interface AirMetadata {
  version: 1;
  session: string;
  generatedAt: string;
  methods: Record<string, AirMethodMeta>;
}
