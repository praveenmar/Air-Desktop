import type {
  BoundedFieldControlKind,
  BoundedFieldRelation,
  BoundedFieldSelectorSpec,
  CodegenStep,
  LabelContextRenderStatus,
  ResolverSnapshotSource,
  SelectorSpec,
  SnapshotSelectionProvenance,
} from '../../types';
import type { CandidateValidation, RawCandidate } from '../types';

export interface BoundedFieldValidationContext {
  step?: CodegenStep;
  root?: ParentNode;
}

export interface BoundedFieldProofMatch {
  labelElement: Element;
  targetElement: Element;
  containerElement: Element;
  relation: BoundedFieldRelation;
  renderStatus: LabelContextRenderStatus;
  renderReason: string;
  cleanParentSelector?: string;
  cleanChildSelector?: string;
  containerSelector?: string;
  boundedContainerSummary?: string;
  warningCodes?: string[];
}

export interface BoundedFieldProofResult {
  match: BoundedFieldProofMatch | null;
  rejectReason:
    | 'bounded-field-no-label'
    | 'bounded-field-duplicate-label'
    | 'bounded-field-target-binding-failed'
    | 'bounded-field-multiple-targets'
    | 'bounded-field-broad-container'
    | 'bounded-field-no-renderable-scope'
    | 'target_selector_ambiguous'
    | 'target_not_bound_to_field_container'
    | 'bounded-field-global-duplicate-label'
    | 'invalid-target-spec'
    | null;
}

export interface BoundedFieldSpecBuildParams {
  labelText: string;
  target: SelectorSpec;
  controlKind: BoundedFieldControlKind;
  relation?: BoundedFieldRelation;
  originalSelector?: string;
  snapshotSource?: ResolverSnapshotSource | null;
}

export interface BoundedFieldCandidateParams {
  step: CodegenStep;
  snapshot: Document;
  snapshotSelection?: SnapshotSelectionProvenance;
}

export interface BoundedFieldCandidate extends RawCandidate {
  source: 'bounded-field';
  engine: 'bounded-field';
  boundedField: BoundedFieldSelectorSpec;
}

export interface BoundedFieldValidationResult extends CandidateValidation {
  proofSummary?: string;
  matchedContainerSummary?: string | null;
  warningCodes?: string[];
  rejectReason?: string | null;
}
