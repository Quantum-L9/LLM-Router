# Architecture

`@quantum-l9/llm-router` is a reusable TypeScript routing library. `L9LLMRouter` is the supported production execution surface and the only component that composes routing, budget, resilience, and provider dispatch.

## Runtime flow

```text
validated execution task
  -> effective image set merged into task
  -> pure route resolution
  -> request identity and timestamp
  -> atomic process-local budget reservation
  -> provider-family-safe downgrade
  -> per-provider circuit permit
  -> provider dispatch with explicit cancellation and timeout
  -> aggregate execution accounting
  -> budget reconciliation and audit log
```

Route resolution is pure. Request IDs and timestamps are added afterward and do not participate in routing equivalence.

## Module ownership

```text
src/types.ts                     public legacy contracts
src/schemas.ts                   runtime validation for public legacy input
src/matrices/*                   deterministic model and search resolution
src/pricing.ts                   canonical OpenRouter price table
src/budget/*                     process-local admission and spend accounting
src/circuit-breaker.ts           process-local provider health control
src/provider-errors.ts           typed failure classification and redaction
src/providers/*                  provider I/O and SDK transport isolation
src/vision/*                     vision configuration and task planning
src/index.ts                     composition root and supported execution API
src/control-plane/*              internal Phase 1 contract kernel
```

## Provider boundary

Provider clients live under `src/providers/`. Production modules outside `src/index.ts` and `src/providers/` may not import them. ESLint and a programmatic probe enforce the rule.

Existing provider subpath exports remain available during the 1.x line for compatibility. They are deprecated because direct use bypasses budget and circuit controls. Their removal requires a major version.

## Budget state

The built-in budget tracker owns committed spend and active reservations. Admission evaluates both, so concurrent requests inside one JavaScript process cannot all pass against the same unreserved ceiling.

Critical tasks retain the documented override but still reserve and record cost. Reservation identifiers must be non-empty and unique. Client and direct tracker configuration is runtime validated.

The tracker is not a distributed ledger. Multiple processes require an external atomic persistence adapter, which is outside this repository's current scope.

## Circuit state

The circuit breaker owns independent state per provider.

- Closed calls receive ordinary permits.
- The failure threshold opens the circuit.
- The cooldown permits exactly one half-open probe.
- Retryable network, timeout, rate-limit, and server failures count.
- Client, cancellation, budget, policy, and local validation failures do not count.
- Late results from calls acquired before a circuit opened cannot overwrite newer state.

## Provider execution

The OpenAI SDK is isolated behind `OpenAIChatTransport`. SDK retries are disabled. The router controls fallback order explicitly.

OpenRouter fallbacks advance only after retryable failures. Non-retryable client failures and cancellation terminate immediately.

Perplexity consensus executes configured variations in parallel. The selected content remains one successful candidate, while budget-facing cost and token accounting aggregate all successful variations.

## Image safety

Image execution accepts public HTTPS URLs and bounded supported image data URIs. Local, private, loopback, link-local, reserved, and local-domain targets are rejected before dispatch. Option-supplied images are validated and included in route selection before budget reservation.

## Control Plane Phase 1

The Control Plane kernel owns strict runtime contracts, canonical JSON, deterministic identity, immutable builders, policy interfaces, and provider-adapter interfaces. It does not own provider clients, network access, Gate ingress, TransportPacket authority, Graphiti, Neo4j, promotion, mutable global state, or legacy cutover.

The internal barrel `src/control-plane/index.ts` is a deliberate module boundary but is absent from package exports. The one-line pass-through type module was removed because it had no independent responsibility.

Route identity excludes request-specific values and explanatory prose, including route, budget, and provider-health reasons. Complete content hashing still protects those fields.

## Runtime support

The package preserves a Node 20.19.0 compatibility floor for the 1.x line. CI validates the floor plus maintained Node 22 and Node 24 LTS lines. Publish and supply-chain jobs run on Node 24 LTS.
