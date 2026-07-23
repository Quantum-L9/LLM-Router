# Architecture

`@quantum-l9/llm-router` is a reusable TypeScript routing library. The root `L9LLMRouter` is the supported execution surface.

## Runtime flow

```text
validated TaskDescriptor
  -> pure route resolution
  -> atomic process-local budget reservation
  -> provider-family-safe downgrade
  -> per-provider circuit permit
  -> provider dispatch
  -> cost reconciliation and audit log
```

Provider clients live under `src/providers/`. Production modules outside `src/index.ts` and `src/providers/` may not import them. Existing provider subpath exports remain available during the 1.x line for compatibility, but direct use is deprecated because it bypasses budget and circuit controls.

## State scope

The built-in budget tracker and circuit breaker are process-local. They prevent concurrent overspend and provider stampedes inside one process. Distributed enforcement requires an external persistence adapter and is intentionally not claimed here.
