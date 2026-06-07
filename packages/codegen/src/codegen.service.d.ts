/**
 * packages/codegen/src/codegen.service.ts
 *
 * The AIR Code Generation Service â€” "The Compressor".
 *
 * Reads raw recording data from SQLite and produces a compressed,
 * intent-driven CodegenSession (the Semantic Timeline) that can be
 * fed directly to an AI without blowing up the context window.
 *
 * What gets stripped:
 *   - Raw HTML snapshots (can be 100KB-500KB each)
 *   - Network events (not actionable in tests)
 *   - Scroll events (excluded by default â€” noise for most tests)
 *   - Hover events (excluded by default)
 *   - Input heartbeats (trigger=input:progress â€” already filtered at DB level)
 *   - Duplicate edges (deduped by fingerprint hash)
 *   - Pre-navigation UI setup clicks (hamburger expands, container taps)   â† Fix B
 *   - Assertions shared across 2+ destination pages (layout chrome)        â† Fix C
 *
 * What gets preserved:
 *   - Selectors + selector priority (how to find the element)
 *   - Intents (why the user interacted â€” drives self-healing)
 *   - Outcome types (navigation/no_change â€” drives waitForURL/assertions)
 *   - Confidence + sample size (reliability signal for the AI)
 *   - Anchor fingerprints from destination nodes (drives assertions)
 *   - Page URLs (drives page.goto() when needed)
 *
 * Output size target: < 8KB per session for a typical 10-step flow.
 * This fits comfortably in any AI context window alongside the prompt.
 */
import { CodegenSession, CodegenStep, CodegenServiceOptions, SelectorPriority, GenerationEventMetadata } from './types';
import type { ResolverConfig, SnapshotCache } from './selector-resolver';
import { GenerationContextV1 } from '../../../core/types/generation';
export declare const SELECTOR_RANK_MAP: Record<string, number>;
export declare function rankFromPriority(priority: SelectorPriority): number;
export declare function getSourceNodeId(event: Pick<{
    nodeId?: string | null;
}, 'nodeId'> | null | undefined, edge: Pick<{
    fromNodeId?: string | null;
    toNodeId?: string | null;
}, 'fromNodeId' | 'toNodeId'> | null | undefined): string | null;
export declare function normalizeSelectorPriority(raw: string | undefined): SelectorPriority;
export declare function suppressPreNavSetupClicks(steps: CodegenStep[], options?: {
    preserveCompoundOpenSteps?: boolean;
}): CodegenStep[];
/**
 * Collapses redundant focus-click steps when the next step is an input on the
 * same element in the same page context.
 */
export declare function collapseRedundantClickBeforeInput(steps: CodegenStep[]): CodegenStep[];
export declare function compressDuplicateSubmitAfterClick(steps: CodegenStep[]): CodegenStep[];
export declare function compressCustomControlOpenSelectPairs(steps: CodegenStep[]): CodegenStep[];
export declare function deduplicateSharedAssertions(steps: CodegenStep[]): CodegenStep[];
export declare class CodegenService {
    private options;
    private db;
    constructor(options: CodegenServiceOptions);
    /**
     * Lists all sessions available for code generation, newest first.
     */
    listSessions(): Array<{
        sessionId: string;
        url: string;
        startedAt: string;
        eventCount: number;
    }>;
    /**
     * Builds the full Semantic Timeline for a session.
     * This is what gets fed to the AI â€” no raw HTML, no snapshots.
     */
    buildSession(sessionId: string, buildOptions?: {
        preserveCompoundOpenSteps?: boolean;
    }): CodegenSession;
    close(): void;
    loadSnapshots(session: CodegenSession, options?: ResolverConfig): Promise<SnapshotCache>;
    /**
     * PHASE 3B: Lightweight Metadata Extraction
     *
     * Fetches only the minimal metadata required to build the public GenerationContext
     * without loading the massive raw payload. Uses SQLite JSON functions to parse
     * only the specific fields needed (selectorResolution, fallback hints).
     */
    getGenerationEventMetadataByIds(eventIds: string[]): Map<string, GenerationEventMetadata>;
    /**
     * PHASE 3D: Service Orchestration
     *
     * Orchestrates the building of a full session, fetching of lightweight
     * event metadata, and derivation of the pure GenerationContext.
     * This is the entrypoint for future MCP codegen workflows.
     */
    buildGenerationContext(sessionId: string): GenerationContextV1;
}
