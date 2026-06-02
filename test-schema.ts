import { z } from 'zod';
import { ClickEventSchema, OutcomeEventSchema } from './core/types/events.ts';

console.log("=== Testing Legacy Event Parsing ===");
const legacyClickEvent = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  timestamp: 123456789,
  sessionId: "session-123e4567-e89b-12d3-a456-426614174000",
  type: "click",
  fingerprint: {
    selector: "button",
    selectorPriority: "text",
    context: { parentTag: "div", nearestContainerTag: "div" },
    attributes: {},
    attributesHash: "hash123",
  }
};

const parsedLegacy = ClickEventSchema.parse(legacyClickEvent);
console.log("Legacy parses fine:", parsedLegacy.selectorResolution === undefined);

console.log("=== Testing Resolved Event Parsing ===");
const resolvedClickEvent = {
  ...legacyClickEvent,
  selectorResolution: {
    schemaVersion: "air:selector-resolution:v1",
    status: "resolved",
    selected: {
      selector: "button:has-text('Login')",
      engine: "css", // mapped from text
      family: "text",
      source: "shadow-preference",
      replaySafe: true,
    }
  }
};

const parsedResolved = ClickEventSchema.parse(resolvedClickEvent);
console.log("Resolved parses fine:", parsedResolved.selectorResolution!.status === "resolved");

console.log("=== Testing Unresolved Event Parsing ===");
const unresolvedClickEvent = {
  ...legacyClickEvent,
  selectorResolution: {
    schemaVersion: "air:selector-resolution:v1",
    status: "unresolved",
    blockedReason: "no-replay-safe-selector"
  }
};

const parsedUnresolved = ClickEventSchema.parse(unresolvedClickEvent);
console.log("Unresolved parses fine:", parsedUnresolved.selectorResolution!.status === "unresolved");

console.log("=== Testing Engine Inference Logic ===");
function inferSelectorEngine(candidate: any) {
  if (!candidate || !candidate.selector) return "css";
  if (candidate.selector.startsWith('//') || candidate.selector.startsWith('.//')) return "xpath";
  if (candidate.family && candidate.family.includes('xpath')) return "xpath";
  return "css"; 
}

console.log("Engine 'button:has-text(\"Login\")':", inferSelectorEngine({ selector: "button:has-text('Login')", family: "text" }) === "css");
console.log("Engine '//div':", inferSelectorEngine({ selector: "//div", family: "primary" }) === "xpath");
console.log("Engine 'xpath=//div':", inferSelectorEngine({ selector: "xpath=//div", family: "xpath" }) === "xpath");

console.log("All tests passed!");
