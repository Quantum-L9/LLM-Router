# @quantum-l9/llm-router

`@quantum-l9/llm-router` is the shared TypeScript routing library for L9 applications. It validates task input, selects a provider and model deterministically, reserves budget before dispatch, applies provider-family-safe downgrades, controls provider failure pressure, executes through typed provider clients, and reconciles actual cost.

## What is implemented

- Deterministic routing for search, general, and vision task families
- Per-client and global process-local budget enforcement with pre-dispatch reservations
- Per-provider circuit breaking with one half-open recovery probe
- Explicit timeout, cancellation, retry, fallback, and provider-error classification
- OpenRouter and Perplexity clients through an OpenAI SDK transport boundary
- Bounded image URL and inline-image validation
- Runtime validation with Zod 4
- Internal Control Plane Phase 1 contracts, canonical hashing, builders, and boundaries
- Package, declaration, lint-boundary, audit, and isolated-consumer validation

## Installation

The package is published to GitHub Packages.

```bash
npm install @quantum-l9/llm-router
```

Configure the `@quantum-l9` registry and authentication through the consuming environment. Do not commit package tokens or provider credentials.

## Supported runtimes

The 1.x compatibility floor remains Node.js `20.19.0`. CI also validates maintained Node.js 22 and 24 LTS lines. Release and supply-chain jobs run on Node.js 24 LTS.

## Basic use

```ts
import {
  L9LLMRouter,
  TaskComplexity,
  TaskType,
} from '@quantum-l9/llm-router';

const router = new L9LLMRouter({
  perplexityApiKey: process.env.PERPLEXITY_API_KEY!,
  openrouterApiKey: process.env.OPENROUTER_API_KEY!,
  providerTimeoutMs: 60_000,
  providerMaxRetries: 0,
});

router.initClient('tenant-a', {
  monthlyBudgetPerClient: 200,
  weeklyTarget: 50,
  weeklyHardCeiling: 100,
});

const result = await router.execute(
  {
    clientId: 'tenant-a',
    type: TaskType.CONTENT_GENERATION,
    complexity: TaskComplexity.MEDIUM,
    expectedOutputTokens: 1_500,
  },
  'You are a careful writer.',
  'Draft the article.',
);
```

`execute()` requires a non-empty `clientId`. The router rejects malformed execution input before allocating a request ID, reserving budget, or dispatching a provider call.

## Custom OpenRouter endpoint

The OpenRouter provider targets `https://openrouter.ai/api/v1` by default. Any OpenAI-compatible endpoint (corporate gateway, proxy, or self-hosted backend) can be substituted without code changes:

```ts
// Option 1 — explicit config (highest precedence)
const router = new L9LLMRouter({
  perplexityApiKey: process.env.PERPLEXITY_API_KEY!,
  openrouterApiKey: process.env.OPENROUTER_API_KEY!,
  openrouterBaseUrl: 'https://llm-gateway.internal.example/v1',
});

// Option 2 — environment variable (used when config omits openrouterBaseUrl)
// OPENROUTER_BASE_URL=https://llm-gateway.internal.example/v1
```

Resolution precedence is explicit config, then `OPENROUTER_BASE_URL`, then the OpenRouter cloud default. Overrides are validated as absolute http(s) URLs at construction time and trailing slashes are normalized. Invalid values throw `InvalidBaseUrlError` (or `RouterConfigValidationError` at config parse time). Deployments that set neither are unaffected.

## Vision execution

Images supplied through execution options are merged into the validated task before routing. This ensures model selection and budget estimation use the same image count that reaches the provider.

```ts
const result = await router.execute(
  {
    clientId: 'tenant-a',
    type: TaskType.SCREENSHOT_ANALYSIS,
    complexity: TaskComplexity.MEDIUM,
  },
  'Inspect the screenshots.',
  'Compare the layouts.',
  {
    images: [
      'https://cdn.example.com/current.png',
      'https://cdn.example.com/competitor.png',
    ],
  },
);
```

Only HTTPS public URLs and bounded `data:image/*;base64` payloads are accepted. Private, loopback, link-local, reserved, local-domain, non-image, and oversized inline targets are rejected before provider dispatch.

## Search consensus

For eligible high-complexity Perplexity tasks, `{ consensus: true }` executes the configured variations in parallel. The returned content is selected from the successful responses, while token and cost fields represent the aggregate successful consensus execution so budget reconciliation does not undercount spend.

## Budget semantics

The built-in tracker is process-local.

1. Estimate the route cost.
2. Evaluate committed spend plus active reservations.
3. Reserve estimated cost before provider dispatch.
4. Release the reservation on confirmed unbilled failure.
5. Reconcile the reservation to actual reported cost on success.

This prevents concurrent overspend inside one process. It does not claim distributed enforcement across processes or machines.

## Provider failure behavior

Provider failures are classified as network, timeout, rate limit, server, client, cancellation, local, or unknown.

- Retryable provider failures may advance through an explicit fallback chain.
- Client errors, cancellation, and local validation failures stop immediately.
- Local validation and budget failures do not poison provider circuit health.
- A circuit permits only one half-open recovery probe.
- Late successes from older calls cannot close a circuit opened by newer failures.

The OpenAI SDK has hidden retries disabled. Every router-controlled fallback remains visible and bounded.

## Direct provider imports

These 1.x compatibility exports remain available:

```ts
import { OpenRouterClient } from '@quantum-l9/llm-router/openrouter';
import { PerplexityClient } from '@quantum-l9/llm-router/perplexity';
```

They are deprecated because they bypass router-level budget and circuit controls. Use `L9LLMRouter` for production execution. Removal requires a future major-version migration.

## Internal Control Plane kernel

Phase 1 Control Plane files are compiled but are not exposed through `package.json` exports. They define strict contracts, deterministic canonicalization, identity verification, immutable builders, policy interfaces, and provider-adapter interfaces. They perform no network calls and do not replace the legacy router.

See [`docs/control-plane-architecture.md`](docs/control-plane-architecture.md).

## Validation

```bash
npm ci
npm run verify:all
```

`verify:all` runs the production build, strict type verification, declaration-consumer compilation, ESLint, the provider-boundary probe, Vitest, production dependency audit, package allowlist inspection, isolated tarball installation, and package export smoke tests.

Operational procedures and failure recovery are documented in [`RUNBOOK.md`](RUNBOOK.md). Architecture and ownership boundaries are documented in [`ARCHITECTURE.md`](ARCHITECTURE.md).
