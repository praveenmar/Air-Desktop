# D3.5 Resolver Configuration

`air-generate` now supports additive selector resolver options via environment variables.

| Env Var | Type | Default | Description |
|---|---|---|---|
| `AIR_ENABLE_LLM_SELECTOR_FALLBACK` | boolean | `false` | Enables selector LLM fallback for unresolved steps. |
| `AIR_RESOLVER_MIN_SCORE` | number | `0.7` | Minimum deterministic candidate score to accept. |
| `AIR_MAX_SNAPSHOT_BYTES` | number | `2000000` | Snapshot size guard before DOM parsing/validation. |
| `AIR_MAX_SNAPSHOT_EXCERPT_CHARS` | number | `2000` | Max chars of redacted snapshot sent to selector fallback prompt. |
| `AIR_SELECTOR_LLM_TIMEOUT_MS` | number | `20000` | Timeout for selector fallback LLM call. |
| `AIR_MAX_LLM_FALLBACK_PER_SESSION` | number | computed | Optional override for fallback circuit breaker cap. |

Computed fallback cap (when not overridden):

`max(2, min(5, ceil(totalSteps * 0.3)))`
