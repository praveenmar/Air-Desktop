import type { CodegenStep, ResolverSnapshotSource, SnapshotCandidateTraceEntry, SnapshotSelectionProvenance, TemporalClass } from './types';
export type SnapshotSelectionMode = 'action' | 'outcome';
export declare const SNAPSHOT_SELECTION_REASONS: {
    readonly SELECTED_EVENT_LOCAL_PAGE_STATE_BY_EVENT_ID: "selected_event_local_pageState_by_eventId";
    readonly SELECTED_EVENT_LOCAL_PAGE_SNAPSHOT_BY_EVENT_ID: "selected_event_local_pageSnapshot_by_eventId";
    readonly SELECTED_SOURCE_NODE_SNAPSHOT_AFTER_EVENT_LOCAL_MISSING: "selected_source_node_snapshot_after_event_local_missing";
    readonly SELECTED_IC_EXACT_FOR_ACTION_FALLBACK: "selected_ic_exact_for_action_fallback";
    readonly SELECTED_IC_STABLE_BY_URL_FOR_ACTION_FALLBACK: "selected_ic_stable_by_url_for_action_fallback";
    readonly SELECTED_URL_EVENT_FALLBACK_LAST_RESORT: "selected_url_event_fallback_last_resort";
    readonly SELECTED_IC_EXACT_STABLE_FOR_OUTCOME_STATE: "selected_ic_exact_stable_for_outcome_state";
    readonly SELECTED_IC_EXACT_FOR_OUTCOME_STATE: "selected_ic_exact_for_outcome_state";
    readonly SELECTED_OUTCOME_EVENT_SNAPSHOT: "selected_outcome_event_snapshot";
    readonly SELECTED_DESTINATION_NODE_SNAPSHOT_AFTER_OUTCOME_MISSING: "selected_destination_node_snapshot_after_outcome_missing";
    readonly SELECTED_UNAVAILABLE_NO_SNAPSHOT_FOUND: "selected_unavailable_no_snapshot_found";
};
export declare const SNAPSHOT_SKIP_REASONS: {
    readonly EVENT_LOCAL_UNAVAILABLE_MISSING_EVENT_ID: "event_local_unavailable_missing_eventId";
    readonly EVENT_LOCAL_PAGE_STATE_MISSING: "event_local_pageState_missing_for_eventId";
    readonly EVENT_LOCAL_PAGE_SNAPSHOT_MISSING: "event_local_pageSnapshot_missing_for_eventId";
    readonly SOURCE_NODE_SNAPSHOT_MISSING: "source_node_snapshot_missing";
    readonly INTERACTION_CONTEXT_EXACT_MISSING: "interaction_context_exact_missing";
    readonly INTERACTION_CONTEXT_STABLE_BY_URL_MISSING: "interaction_context_stable_by_url_missing";
    readonly INTERACTION_CONTEXT_ANY_BY_URL_MISSING: "interaction_context_any_by_url_missing";
    readonly URL_EVENT_FALLBACK_MISSING: "url_event_fallback_missing";
    readonly OUTCOME_EVENT_SNAPSHOT_MISSING: "outcome_event_snapshot_missing";
    readonly DESTINATION_NODE_SNAPSHOT_MISSING: "destination_node_snapshot_missing";
    readonly NORMALIZED_URL_MISSING: "normalized_url_missing";
    readonly CONTROL_SIGNATURE_MISSING: "control_signature_missing";
    readonly EXACT_IC_SKIPPED_MISSING_CONTROL_SIGNATURE: "exact_ic_skipped_missing_control_signature";
    readonly IC_STALE: "ic_stale";
    readonly SNAPSHOT_PARSE_FAILED: "snapshot_parse_failed";
    readonly POST_ACTION_NOT_ALLOWED_FOR_ACTION_RESOLUTION: "post_action_not_allowed_for_action_resolution";
    readonly TARGET_MISSING_IN_SNAPSHOT: "target_missing_in_snapshot";
    readonly STATE_BOUNDARY_CROSSED: "state_boundary_crossed";
    readonly TAB_MISMATCH: "tab_mismatch";
    readonly INCOMPATIBLE_STATE: "incompatible_state";
    readonly IC_TAB_UNKNOWN: "ic_tab_unknown";
    readonly SHADOW_DOM_NOT_SERIALIZED: "shadow_dom_not_serialized";
    readonly CLOSED_SHADOW_DOM_UNOBSERVABLE: "closed_shadow_dom_unobservable";
    readonly HIGHER_PRIORITY_CANDIDATE_ALREADY_SELECTED: "higher_priority_candidate_already_selected";
};
export type HardBoundaryKind = 'navigation' | 'url_change' | 'spa_route_change' | 'tab_change' | 'cross_tab_handoff';
export interface StateBoundary {
    timestamp: number;
    kind: HardBoundaryKind;
    eventId?: string;
    traceId?: string | null;
    tabId?: string | null;
    fromTabId?: string | null;
    toTabId?: string | null;
    fromNormalizedUrl?: string | null;
    toNormalizedUrl?: string | null;
}
export interface SnapshotHandle {
    source: ResolverSnapshotSource;
    temporalClass: TemporalClass;
    eventId?: string;
    sourceNodeId?: string;
    timestamp?: number;
    tabId?: string | null;
    normalizedUrl?: string;
    controlSignature?: string;
    confidenceScore?: number;
    load(): Document | null;
}
export interface EventLocalSnapshotHandles {
    pageState?: SnapshotHandle;
    pageSnapshot?: SnapshotHandle;
}
export interface SnapshotInventory {
    snapshotEngineAvailable?: boolean;
    hardBoundaries: StateBoundary[];
    icBoundaryToleranceMs?: number;
    eventLocalByEventId: Map<string, EventLocalSnapshotHandles>;
    interactionContextExactStable: Map<string, SnapshotHandle>;
    interactionContextExactAny: Map<string, SnapshotHandle>;
    interactionContextStableByUrl: Map<string, SnapshotHandle>;
    interactionContextAnyByUrl: Map<string, SnapshotHandle>;
    outcomeEventByTraceId: Map<string, SnapshotHandle>;
    sourceNodeById: Map<string, SnapshotHandle>;
    destinationNodeById: Map<string, SnapshotHandle>;
    urlEventFallbackByNormalizedUrl: Map<string, SnapshotHandle>;
}
export interface SnapshotSelectionResult {
    snapshot: Document | null;
    provenance: SnapshotSelectionProvenance;
    evaluatedCandidates: SnapshotCandidateTraceEntry[];
}
export declare function selectSnapshotForAction(step: CodegenStep, inventory: SnapshotInventory): SnapshotSelectionResult;
export declare function selectSnapshotForOutcome(step: CodegenStep, inventory: SnapshotInventory): SnapshotSelectionResult;
export declare function selectSnapshotForStep(step: CodegenStep, inventory: SnapshotInventory, mode?: SnapshotSelectionMode): SnapshotSelectionResult;
