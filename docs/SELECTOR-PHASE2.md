# Selector Phase 2 Notes

## Temporary Duplication

Selector generation currently exists in two places:

1. `interceptor/interceptor.js` (runtime source of truth used in browser injection)
2. `packages/shared/src/selectors.ts` (shared copy for reporter/test parity)

This duplication is intentional for Phase 2 because interceptor runs as an injected script and cannot import workspace modules at runtime.

## Phase Rule

Phase 2 is a behavior-freeze step:

- Keep selector behavior unchanged.
- Keep selector logic consolidated in `shared/selectors.ts`.
- Do not force architecture splitting yet (`selector-priority.ts`, `selector-generator.ts`).

The first D4 consumer (`reporter/capture/candidates.ts`) should call `generateOptimalSelector()` directly. Split only after D4 usage patterns are stable.

## Guardrail

`packages/shared/__tests__/selector-consistency.spec.ts` compares selector output between interceptor and shared utilities on real pages to catch drift immediately.

## Future Unification

Planned in a later phase once interceptor loading supports shared module bundling.
