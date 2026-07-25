import { AIREventSchema } from '../core/types/events';

const legacyEvent = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  timestamp: Date.now(),
  sessionId: "session-abc-123",
  type: "click",
  fingerprint: {
    selector: "button",
    attributes: {}
  }
};

const resolvedEvent = {
  ...legacyEvent,
  selectorResolution: {
    schemaVersion: "air:selector-resolution:v1",
    status: "resolved",
    selected: {
      selector: "button.login",
      engine: "css",
      source: "shadow-preference",
      replaySafe: true
    }
  }
};

const unresolvedEvent = {
  ...legacyEvent,
  selectorResolution: {
    schemaVersion: "air:selector-resolution:v1",
    status: "unresolved",
    blockedReason: "no-replay-safe-selector"
  }
};

const outcomeEvent = {
  id: "123e4567-e89b-12d3-a456-426614174001",
  timestamp: Date.now(),
  sessionId: "session-abc-123",
  type: "outcome"
};

function check(name: string, obj: any) {
  const result = AIREventSchema.safeParse(obj);
  if (result.success) {
    console.log(name + ": pass");
  } else {
    console.log(name + ": FAIL -> " + result.error.errors[0].message + " at " + result.error.errors[0].path.join('.'));
  }
}

check("1. Legacy", legacyEvent);
check("2. Resolved", resolvedEvent);
check("3. Unresolved", unresolvedEvent);
check("4. Outcome", outcomeEvent);
