import { GenerationContextV1 } from '../../../core/types/generation';
import { CodegenSession, GenerationEventMetadata } from './types';
/**
 * Phase 3C: Pure GenerationContext Builder
 *
 * Derives a pristine GenerationContextV1 from an internal CodegenSession
 * and lightweight event metadata.
 *
 * Does NOT query the DB, load HTML snapshots, or interact with heavy services.
 * Purely deterministic transformation.
 */
export declare function deriveGenerationContext(input: {
    session: CodegenSession;
    eventsById: Map<string, GenerationEventMetadata>;
}): GenerationContextV1;
