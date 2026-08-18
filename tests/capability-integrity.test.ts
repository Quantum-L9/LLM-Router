import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GeneralModel,
  Provider,
  SearchPolicySource,
  TaskComplexity,
  TaskType,
  type LLMResponse,
  type RoutingDecision,
} from '../src/types.js';
import {
  BudgetReservationError,
  L9LLMRouter,
  UnsupportedCapabilityCombinationError,
  resolveCapabilities,
  resolveRoute,
  type CapabilityConflictCode,
} from '../src/index.js';
import { ProviderRequestError } from '../src/provider-errors.js';

const response: LLMResponse = {
  content: 'ok', model: GeneralModel.GPT4O_MINI, provider: Provider.OPENROUTER,
  inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.1, latencyMs: 5, cached: false,
};

function harness() {
  const openrouterClient = {
    complete: async () => response,
    completeWithFallback: async () => response,
    completeWithVision: async () => response,
  };
  const perplexityClient = {
    complete: async () => ({ ...response, model: GeneralModel.GPT4O_MINI, provider: Provider.PERPLEXITY }),
    completeWithConsensus: async () => ({
      best: { ...response, model: GeneralModel.GPT4O_MINI, provider: Provider.PERPLEXITY },
      all: [], consensusScore: 1,
      aggregate: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.1, latencyMs: 5, citations: [] },
    }),
  };
  const router = new L9LLMRouter(
    { perplexityApiKey: 'p', openrouterApiKey: 'o' },
    { openrouterClient, perplexityClient, idFactory: () => 'task-1', clock: () => new Date('2026-01-01T00:00:00Z') },
  );
  router.initClient('c');
  return router;
}

async function caughtCode(promise: Promise<unknown>): Promise<CapabilityConflictCode | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(UnsupportedCapabilityCombinationError);
    return (error as UnsupportedCapabilityCombinationError).code;
  }
}

describe('capability resolver is the single internal authority', () => {
  it('resolves search policy source and vision from one place', () => {
    const caps = resolveCapabilities({ type: TaskType.SCREENSHOT_ANALYSIS, complexity: TaskComplexity.MEDIUM, images: ['https://cdn.example.com/a.png'] });
    expect(caps).toEqual({ searchRequired: false, searchPolicySource: SearchPolicySource.TASK_DEFAULT, visionRequired: true, imagesProvided: true });

    const explicit = resolveCapabilities({ type: TaskType.COMPETITOR_RESEARCH, complexity: TaskComplexity.MEDIUM, requiresSearch: false });
    expect(explicit).toEqual({ searchRequired: false, searchPolicySource: SearchPolicySource.EXPLICIT, visionRequired: false, imagesProvided: false });
  });

  it('exposes capability evidence on every routing resolution', () => {
    const vision = resolveRoute({ type: TaskType.SCREENSHOT_ANALYSIS, complexity: TaskComplexity.MEDIUM, images: ['https://cdn.example.com/a.png'] });
    expect(vision).toMatchObject({ searchRequired: false, searchPolicySource: SearchPolicySource.TASK_DEFAULT, visionRequired: true });

    const search = resolveRoute({ type: TaskType.MARKET_RESEARCH, complexity: TaskComplexity.MEDIUM });
    expect(search).toMatchObject({ searchRequired: true, searchPolicySource: SearchPolicySource.TASK_DEFAULT, visionRequired: false });

    const general = resolveRoute({ type: TaskType.CONTENT_GENERATION, complexity: TaskComplexity.MEDIUM });
    expect(general).toMatchObject({ searchRequired: false, searchPolicySource: SearchPolicySource.TASK_DEFAULT, visionRequired: false });
  });

  it('keeps the vision-task inventory inside the search-policy module', () => {
    // The double-interpretation bug lived because dispatch re-derived vision
    // from a private set in index.ts. The canonical set must live only in the
    // capabilities module; index.ts may re-export it but never re-derive a
    // plane from it.
    expect(readFileSync('src/index.ts', 'utf8')).not.toContain('VISION_TASKS.has');
    expect(readFileSync('src/matrices/search-policy.ts', 'utf8')).toContain('export const VISION_TASKS');
  });
});

describe('fail-closed capability validation happens before any provider action', () => {
  it('refuses a vision task without images (VISION_INPUT_REQUIRED) before budget reservation', async () => {
    const router = harness();
    const code = await caughtCode(router.execute(
      { clientId: 'c', type: TaskType.SCREENSHOT_ANALYSIS, complexity: TaskComplexity.MEDIUM },
      's', 'u',
    ));
    expect(code).toBe('VISION_INPUT_REQUIRED');
    expect(router.getClientBudgetReport('c')).toMatchObject({ monthSpend: 0, reservedSpend: 0, activeReservations: 0 });
    expect(router.getCircuitState(Provider.OPENROUTER).failureCount).toBe(0);
  });

  it('refuses images on a non-vision task (IMAGES_NOT_SUPPORTED_FOR_TASK)', async () => {
    const router = harness();
    const code = await caughtCode(router.execute(
      { clientId: 'c', type: TaskType.CONTENT_GENERATION, complexity: TaskComplexity.MEDIUM },
      's', 'u', { images: ['https://cdn.example.com/a.png'] },
    ));
    expect(code).toBe('IMAGES_NOT_SUPPORTED_FOR_TASK');
  });

  it('refuses search modifiers without search (SEARCH_MODIFIER_WITHOUT_SEARCH)', async () => {
    const router = harness();
    const code = await caughtCode(router.execute(
      { clientId: 'c', type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.MEDIUM, requiresSearch: false, domainFilter: ['example.com'] },
      's', 'u',
    ));
    expect(code).toBe('SEARCH_MODIFIER_WITHOUT_SEARCH');
    expect(router.getClientBudgetReport('c')).toMatchObject({ monthSpend: 0, reservedSpend: 0, activeReservations: 0 });
  });

  it('refuses consensus without a search-backed route (CONSENSUS_REQUIRES_SEARCH)', async () => {
    const router = harness();
    const code = await caughtCode(router.execute(
      { clientId: 'c', type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.MEDIUM, requiresSearch: false },
      's', 'u', { consensus: true },
    ));
    expect(code).toBe('CONSENSUS_REQUIRES_SEARCH');
    expect(router.getClientBudgetReport('c')).toMatchObject({ monthSpend: 0, reservedSpend: 0, activeReservations: 0 });
  });

  it('still refuses search + vision with the legacy code and requested payload', () => {
    const failed = (() => {
      try {
        resolveRoute({ type: TaskType.SCREENSHOT_ANALYSIS, complexity: TaskComplexity.MEDIUM, requiresSearch: true, images: ['https://cdn.example.com/a.png'] });
        return undefined;
      } catch (error) {
        return error as UnsupportedCapabilityCombinationError;
      }
    })();
    expect(failed).toBeInstanceOf(UnsupportedCapabilityCombinationError);
    expect(failed?.code).toBe('UNSUPPORTED_CAPABILITY_COMBINATION');
    expect(failed?.requested).toEqual({ taskType: TaskType.SCREENSHOT_ANALYSIS, searchRequired: true, imageCount: 1 });
  });
});

describe('failed routed calls are auditable', () => {
  it('records FAILED entries with classification for provider failures', async () => {
    const down = () => { throw new ProviderRequestError('gateway down', { provider: Provider.OPENROUTER, kind: 'server', retryable: true, status: 503, code: 'ECONNRESET' }); };
    const router = new L9LLMRouter(
      { perplexityApiKey: 'p', openrouterApiKey: 'o' },
      { openrouterClient: { complete: down, completeWithFallback: down, completeWithVision: down }, perplexityClient: { complete: async () => response, completeWithConsensus: async () => ({ best: response, all: [], consensusScore: 1, aggregate: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, latencyMs: 0, citations: [] } }) }, idFactory: () => 'task-1' },
    );
    router.initClient('c');
    await expect(router.execute(
      { clientId: 'c', type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.MEDIUM, requiresSearch: false },
      'system', 'user',
    )).rejects.toThrow();
    const logged = router.getCallLog()[0] as RoutingDecision;
    expect(logged.outcome).toBe('FAILED');
    expect(logged.failureKind).toBe('server');
    expect(logged.errorCode).toBe('ECONNRESET');
    expect(logged.searchRequired).toBe(false);
  });

  it('records FAILED entries for local policy failures with the error name', async () => {
    // A budget refusal is a local policy failure that happens after route
    // resolution and before provider dispatch — it must still be auditable.
    const exhaustedStore = {
      initClient: async () => undefined,
      reserveTask: async () => { throw new BudgetReservationError('budget exhausted'); },
      reconcile: async () => undefined,
      release: async () => undefined,
      recordSpend: async () => undefined,
      resetDaily: async () => undefined,
      resetWeekly: async () => undefined,
      resetMonthly: async () => undefined,
      resetGlobalMonthly: async () => undefined,
      checkSurgeAllowance: async () => false,
      getClientBudgetReport: async () => undefined,
      getAllBudgetReports: async () => [],
      getGlobalSpend: async () => undefined,
    };
    const router = new L9LLMRouter(
      { perplexityApiKey: 'p', openrouterApiKey: 'o' },
      { budgetStore: exhaustedStore, idFactory: () => 'task-1' },
    );
    await expect(router.execute(
      { clientId: 'c', type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.MEDIUM, requiresSearch: true },
      's', 'u',
    )).rejects.toThrow();
    const logged = router.getCallLog()[0] as RoutingDecision;
    expect(logged.outcome).toBe('FAILED');
    expect(['local', 'unknown']).toContain(logged.failureKind);
    expect(logged.errorCode).toBeDefined();
  });

  it('records SUCCESS entries on the existing happy path', async () => {
    const router = harness();
    await router.execute({ clientId: 'c', type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.MEDIUM, requiresSearch: false }, 's', 'u');
    expect(router.getCallLog()[0]).toMatchObject({ outcome: 'SUCCESS' });
  });

  it('never leaks prompts, keys, or image contents into the audit', async () => {
    const down = () => { throw new ProviderRequestError('boom', { provider: Provider.OPENROUTER, kind: 'server', retryable: true }); };
    const router = new L9LLMRouter(
      { perplexityApiKey: 'pplx-secret', openrouterApiKey: 'or-secret' },
      { openrouterClient: { complete: down, completeWithFallback: down, completeWithVision: down }, perplexityClient: { complete: async () => response, completeWithConsensus: async () => ({ best: response, all: [], consensusScore: 1, aggregate: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, latencyMs: 0, citations: [] } }) } },
    );
    router.initClient('c');
    await expect(router.execute(
      { clientId: 'c', type: TaskType.SCREENSHOT_ANALYSIS, complexity: TaskComplexity.MEDIUM, requiresSearch: false },
      'system prompt with secret-sauce', 'user prompt with secret-sauce',
      { images: ['https://cdn.example.com/private-shot.png'] },
    )).rejects.toThrow();
    const serialized = JSON.stringify(router.getCallLog());
    expect(serialized).not.toContain('pplx-secret');
    expect(serialized).not.toContain('or-secret');
    expect(serialized).not.toContain('secret-sauce');
    expect(serialized).not.toContain('private-shot.png');
  });
});
