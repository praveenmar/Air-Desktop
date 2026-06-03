import {
  GenerationContextV1,
  GenerationStepV1,
  GenerationAssertion,
  GenerationContextSchemaV1,
} from '../../../core/types/generation';
import { CodegenSession, CodegenStep, GenerationEventMetadata, CodegenAssertion } from './types';

/**
 * Phase 3C: Pure GenerationContext Builder
 * 
 * Derives a pristine GenerationContextV1 from an internal CodegenSession
 * and lightweight event metadata.
 * 
 * Does NOT query the DB, load HTML snapshots, or interact with heavy services.
 * Purely deterministic transformation.
 */
export function deriveGenerationContext(input: {
  session: CodegenSession;
  eventsById: Map<string, GenerationEventMetadata>;
}): GenerationContextV1 {
  const { session, eventsById } = input;

  // Handle recordedAt safely
  let recordedAt = Date.now();
  if (typeof session.recordedAt === 'number') {
    recordedAt = session.recordedAt;
  } else if (typeof session.recordedAt === 'string') {
    const parsed = Date.parse(session.recordedAt);
    if (!isNaN(parsed)) {
      recordedAt = parsed;
    }
  }

  const steps: GenerationStepV1[] = session.steps.map((step) => {
    const metadata = step.eventId ? eventsById.get(step.eventId) : undefined;
    const selectorResolution = metadata?.selectorResolution;

    const isTargetNeeded = actionNeedsTarget(step.action, step);

    let locatorStatus: GenerationStepV1['locatorStatus'] = 'not_applicable';
    let resolvedTarget: GenerationStepV1['resolvedTarget'] = undefined;
    let fallbackHints: GenerationStepV1['fallbackHints'] = undefined;

    if (isTargetNeeded) {
      if (
        selectorResolution &&
        selectorResolution.status === 'resolved' &&
        selectorResolution.selected &&
        selectorResolution.selected.replaySafe === true &&
        typeof selectorResolution.selected.selector === 'string' &&
        selectorResolution.selected.selector.trim().length > 0 &&
        (selectorResolution.selected.engine === 'css' || selectorResolution.selected.engine === 'xpath')
      ) {
        locatorStatus = 'resolved';
        resolvedTarget = {
          kind: selectorResolution.selected.engine,
          value: selectorResolution.selected.selector,
          source: 'selectorResolution',
          replaySafe: true,
        };
      } else {
        locatorStatus = 'unresolved';
        
        // Build fallback hints
        const legacySelector = metadata?.fallbackHints?.legacySelector ?? step.selector;
        const elementText = metadata?.fallbackHints?.elementText ?? step.fingerprint?.textExcerpt;
        const tagName = metadata?.fallbackHints?.tagName ?? step.fingerprint?.tagName;

        const hints: NonNullable<GenerationStepV1['fallbackHints']> = {};
        if (legacySelector) hints.legacySelector = legacySelector;
        if (elementText) hints.elementText = elementText;
        if (tagName) hints.tagName = tagName;

        if (Object.keys(hints).length > 0) {
          fallbackHints = hints;
        }
      }
    }

    const assertions: GenerationAssertion[] = (step.assertions || []).map(mapAssertion);

    const mappedStep: GenerationStepV1 = {
      stepIndex: step.step,
      eventId: step.eventId,
      traceId: step.traceId,
      action: step.action,
      intent: step.intent,
      value: step.value,
      locatorStatus,
      resolvedTarget,
      fallbackHints,
      selectorResolution,
      assertions,
      pageUrl: step.pageUrl,
      normalizedUrl: step.normalizedUrl,
      outcomeType: step.outcomeType,
      confidence: step.confidence,
    };

    return stripUndefined(mappedStep) as GenerationStepV1;
  });

  const context: GenerationContextV1 = {
    schemaVersion: "air:generation-context:v1",
    sessionId: session.sessionId,
    url: session.url,
    recordedAt,
    steps,
    metadata: {
      generatedAt: Date.now(),
      source: "air-db"
    }
  };

  return GenerationContextSchemaV1.parse(context);
}

/**
 * Type-safe helper to deeply or shallowly strip undefined fields
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result) as Array<keyof T>) {
    if (result[key] === undefined) {
      delete result[key];
    }
  }
  return result;
}

/**
 * Determines whether an action inherently needs a targeted element locator.
 */
function actionNeedsTarget(action: string, step?: CodegenStep): boolean {
  if (['click', 'input', 'submit', 'custom-control-open', 'custom-select', 'custom-menu-select', 'hover'].includes(action)) {
    return true;
  }
  if (action === 'scroll') {
    return !!step?.selector;
  }
  if (action === 'navigate') {
    return false;
  }
  // Default to true for any unknown/future actions to avoid hiding unresolved target problems
  return true;
}

/**
 * Maps internal assertions to the public generation contract shape.
 */
function mapAssertion(assertion: CodegenAssertion): GenerationAssertion {
  let type: GenerationAssertion['type'] = 'custom';
  if (['url', 'element_visible', 'element_text', 'title', 'custom'].includes(assertion.type)) {
    type = assertion.type as GenerationAssertion['type'];
  }

  let source: GenerationAssertion['source'] = undefined;
  if (assertion.source) {
    if (['url', 'url_change', 'navigation', 'outcome'].includes(assertion.source)) {
      source = 'outcome';
    } else if (assertion.source === 'anchor') {
      source = 'anchor';
    } else if (assertion.source === 'user_defined') {
      source = 'user_defined';
    } else {
      source = 'anchor'; // Safe default per requirements
    }
  }

  const mapped: GenerationAssertion = {
    type,
    value: assertion.value,
    selector: assertion.selector,
    confidence: assertion.confidence,
    source,
  };

  return stripUndefined(mapped as unknown as Record<string, unknown>) as GenerationAssertion;
}
