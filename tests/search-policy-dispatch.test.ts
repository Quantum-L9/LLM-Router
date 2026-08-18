import { describe, expect, it } from 'vitest';
import {
  GeneralModel,
  Provider,
  SearchPolicySource,
  SonarModel,
  TaskComplexity,
  TaskType,
  type GeneralModelConfig,
  type LLMResponse,
  type PerplexityConfig,
  type VisionConfig,
} from '../src/types.js';
import { L9LLMRouter, UnsupportedCapabilityCombinationError, requiresSearchProvider } from '../src/index.js';
import { ProviderRequestError } from '../src/provider-errors.js';
import { resolvePerplexityConfig } from '../src/matrices/perplexity-matrix.js';
import { buildRequestBody } from '../src/providers/perplexity.js';
import { resolveVisionConfig } from '../src/vision/index.js';

const response: LLMResponse = {
  content: 'ok', model: GeneralModel.GPT4O_MINI, provider: Provider.OPENROUTER,
  inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.1, latencyMs: 5, cached: false,
};

interface Calls {
  general: GeneralModelConfig[];
  vision: VisionConfig[];
  search: PerplexityConfig[];
  consensus: PerplexityConfig[];
}

function harness() {
  const calls: Calls = { general: [], vision: [], search: [], consensus: [] };
  const openrouterClient = {
    complete: async (config: GeneralModelConfig) => { calls.general.push(config); return response; },
    completeWithFallback: async (config: GeneralModelConfig) => { calls.general.push(config); return { ...response, model: config.model }; },
    completeWithVision: async (config: VisionConfig) => { calls.vision.push(config); return { ...response, model: config.model }; },
  };
  const perplexityClient = {
    complete: async (config: PerplexityConfig) => { calls.search.push(config); return { ...response, model: config.model, provider: Provider.PERPLEXITY }; },
    completeWithConsensus: async (config: PerplexityConfig) => {
      calls.consensus.push(config);
      return {
        best: { ...response, model: config.model, provider: Provider.PERPLEXITY },
        all: [], consensusScore: 1,
        aggregate: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.1, latencyMs: 5, citations: [] },
      };
    },
  };
  const router = new L9LLMRouter(
    { perplexityApiKey: 'p', openrouterApiKey: 'o' },
    { openrouterClient, perplexityClient, idFactory: () => 'task-1', clock: () => new Date('2026-01-01T00:00:00Z') },
  );
  router.initClient('c');
  return { router, calls };
}

describe('§18 provider dispatch follows the resolved search policy', () => {
  it('requiresSearch=true on a general TaskType dispatches the search client only', async () => {
    const { router, calls } = harness();
    const result = await router.execute(
      { clientId: 'c', type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.MEDIUM, requiresSearch: true },
      's', 'u',
    );
    expect(calls.search).toHaveLength(1);
    expect(calls.general).toHaveLength(0);
    expect(calls.vision).toHaveLength(0);
    expect(result.provider).toBe(Provider.PERPLEXITY);
    expect(router.getCallLog()[0]).toMatchObject({
      provider: Provider.PERPLEXITY, searchRequired: true, searchPolicySource: SearchPolicySource.EXPLICIT,
    });
  });

  it('requiresSearch=false on a default-search TaskType dispatches the general client only', async () => {
    const { router, calls } = harness();
    const result = await router.execute(
      { clientId: 'c', type: TaskType.COMPETITOR_RESEARCH, complexity: TaskComplexity.HIGH, requiresSearch: false },
      's', 'u',
    );
    expect(calls.general).toHaveLength(1);
    expect(calls.search).toHaveLength(0);
    expect(calls.consensus).toHaveLength(0);
    expect(result.provider).toBe(Provider.OPENROUTER);
    expect(router.getCallLog()[0]).toMatchObject({
      provider: Provider.OPENROUTER, searchRequired: false, searchPolicySource: SearchPolicySource.EXPLICIT,
    });
  });

  it('omitted requiresSearch keeps the TaskType default plane and records TASK_DEFAULT', async () => {
    const { router, calls } = harness();
    await router.execute({ clientId: 'c', type: TaskType.FACT_VERIFICATION, complexity: TaskComplexity.MEDIUM }, 's', 'u');
    expect(calls.search).toHaveLength(1);
    expect(router.getCallLog()[0]).toMatchObject({ searchRequired: true, searchPolicySource: SearchPolicySource.TASK_DEFAULT });
  });

  it('a visual task dispatches the vision path with its images intact', async () => {
    const { router, calls } = harness();
    await router.execute(
      { clientId: 'c', type: TaskType.SCREENSHOT_ANALYSIS, complexity: TaskComplexity.MEDIUM, requiresSearch: false },
      's', 'u', { images: ['https://cdn.example.com/a.png'] },
    );
    expect(calls.vision).toHaveLength(1);
    expect(calls.search).toHaveLength(0);
    expect(router.getCallLog()[0]).toMatchObject({ searchRequired: false, searchPolicySource: SearchPolicySource.EXPLICIT });
  });

  it('the audited model matches the model actually dispatched', async () => {
    const { router, calls } = harness();
    await router.execute({ clientId: 'c', type: TaskType.MARKET_RESEARCH, complexity: TaskComplexity.HIGH }, 's', 'u');
    expect(calls.search[0].model).toBe(router.getCallLog()[0].model);
  });
});

describe('§6 search + vision fails closed instead of losing a capability', () => {
  it('rejects a visual task carrying images that also requires search', async () => {
    const { router, calls } = harness();
    await expect(router.execute(
      { clientId: 'c', type: TaskType.SCREENSHOT_ANALYSIS, complexity: TaskComplexity.MEDIUM, requiresSearch: true },
      's', 'u', { images: ['https://cdn.example.com/a.png'] },
    )).rejects.toBeInstanceOf(UnsupportedCapabilityCombinationError);
    // No capability was silently chosen, and no provider was touched.
    expect(calls.search).toHaveLength(0);
    expect(calls.vision).toHaveLength(0);
    expect(calls.general).toHaveLength(0);
  });

  it('carries a stable machine-readable code and the requested capabilities', async () => {
    const { router } = harness();
    const error = await router.execute(
      { clientId: 'c', type: TaskType.VISUAL_QA, complexity: TaskComplexity.HIGH, requiresSearch: true, images: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'] },
      's', 'u',
    ).catch((caught: unknown) => caught as UnsupportedCapabilityCombinationError);
    expect(error).toBeInstanceOf(UnsupportedCapabilityCombinationError);
    expect(error.code).toBe('UNSUPPORTED_CAPABILITY_COMBINATION');
    expect(error.name).toBe('UnsupportedCapabilityCombinationError');
    expect(error.requested).toEqual({ taskType: TaskType.VISUAL_QA, searchRequired: true, imageCount: 2 });
  });

  it('reserves no budget and opens no circuit when the combination is refused', async () => {
    const { router } = harness();
    await expect(router.execute(
      { clientId: 'c', type: TaskType.LAYOUT_VALIDATION, complexity: TaskComplexity.MEDIUM, requiresSearch: true, images: ['https://cdn.example.com/a.png'] },
      's', 'u',
    )).rejects.toThrow(UnsupportedCapabilityCombinationError);
    expect(router.getClientBudgetReport('c')).toMatchObject({ monthSpend: 0, reservedSpend: 0, activeReservations: 0 });
    expect(router.getCircuitState(Provider.PERPLEXITY).failureCount).toBe(0);
    expect(router.getCircuitState(Provider.OPENROUTER).failureCount).toBe(0);
    expect(router.getCallLog()).toHaveLength(0);
  });

  it('leaves vision model selection for a given image count exactly as it was', () => {
    const { router } = harness();
    // Regression guard: the conflict check must not perturb the image count the
    // vision matrix sees on valid vision routes — and a vision task without
    // images must fail closed instead of resolving to a phantom vision route.
    for (const images of [undefined, []] as (string[] | undefined)[]) {
      const failed = (() => {
        try {
          router.route({ clientId: 'c', type: TaskType.SCREENSHOT_ANALYSIS, complexity: TaskComplexity.MEDIUM, images });
          return undefined;
        } catch (error) {
          return error as UnsupportedCapabilityCombinationError;
        }
      })();
      expect(failed).toBeInstanceOf(UnsupportedCapabilityCombinationError);
      expect(failed?.code).toBe('VISION_INPUT_REQUIRED');
    }
    for (const images of [['https://cdn.example.com/a.png'], ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png']]) {
      for (const complexity of Object.values(TaskComplexity)) {
        const decision = router.route({ clientId: 'c', type: TaskType.SCREENSHOT_ANALYSIS, complexity, images });
        const expected = resolveVisionConfig(TaskType.SCREENSHOT_ANALYSIS, complexity, images.length);
        expect({ model: decision.model, cost: decision.estimatedCost }).toEqual({ model: expected.model, cost: expected.estimatedCostPerCall });
      }
    }
  });

  it('a visual TaskType with no images fails closed even when search is requested', async () => {
    const { router, calls } = harness();
    await expect(router.execute(
      { clientId: 'c', type: TaskType.SCREENSHOT_ANALYSIS, complexity: TaskComplexity.MEDIUM, requiresSearch: true },
      's', 'u',
    )).rejects.toMatchObject({ name: 'UnsupportedCapabilityCombinationError', code: 'VISION_INPUT_REQUIRED' });
    // No capability was silently chosen, and no provider was touched.
    expect(calls.search).toHaveLength(0);
    expect(calls.vision).toHaveLength(0);
    expect(calls.general).toHaveLength(0);
  });
});

describe('§7 Perplexity config agrees with the routing decision', () => {
  it('never resolves a search config with search disabled', () => {
    for (const type of Object.values(TaskType)) {
      for (const complexity of Object.values(TaskComplexity)) {
        for (const requiresSearch of [true, false, undefined]) {
          const task = { type, complexity, requiresSearch, clientId: 'c' };
          if (requiresSearchProvider(task)) {
            expect(resolvePerplexityConfig(task).disableSearch).toBe(false);
          } else {
            // A non-search task reaching the Perplexity resolver is a contract
            // violation, not a configurable state.
            expect(() => resolvePerplexityConfig(task)).toThrow(/non-search task/);
          }
        }
      }
    }
  });

  it('emits web_search_options for every resolved search route', () => {
    const config = resolvePerplexityConfig({ type: TaskType.MARKET_RESEARCH, complexity: TaskComplexity.HIGH, clientId: 'c' });
    expect(buildRequestBody(config, []).web_search_options).toBeDefined();
  });

  it('rejects dispatch if a decision and its plane ever disagree', () => {
    const { router } = harness();
    // Force the contradiction the invariant exists to catch.
    const contradictory = { ...router.route({ clientId: 'c', type: TaskType.MARKET_RESEARCH, complexity: TaskComplexity.HIGH }), searchRequired: false };
    expect(contradictory.provider).toBe(Provider.PERPLEXITY);
    const dispatch = Reflect.get(router, 'dispatchProvider') as (...args: unknown[]) => Promise<LLMResponse>;
    expect(() => dispatch.call(
      router,
      { clientId: 'c', type: TaskType.MARKET_RESEARCH, complexity: TaskComplexity.HIGH },
      contradictory, 's', 'u', undefined, undefined,
    )).toThrow(/disagrees with provider/);
  });
});

describe('§14 consensus is an execution modifier, not search-policy authority', () => {
  it('rejects consensus=true on a non-search route instead of silently ignoring it', async () => {
    const { router, calls } = harness();
    await expect(router.execute(
      { clientId: 'c', type: TaskType.COMPETITOR_RESEARCH, complexity: TaskComplexity.HIGH, requiresSearch: false },
      's', 'u', { consensus: true },
    )).rejects.toMatchObject({ name: 'UnsupportedCapabilityCombinationError', code: 'CONSENSUS_REQUIRES_SEARCH' });
    expect(calls.consensus).toHaveLength(0);
    expect(calls.search).toHaveLength(0);
    expect(calls.general).toHaveLength(0);
  });

  it('still applies consensus on an actually-selected search route', async () => {
    const { router, calls } = harness();
    await router.execute(
      { clientId: 'c', type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.HIGH, requiresSearch: true },
      's', 'u', { consensus: true },
    );
    expect(calls.consensus).toHaveLength(1);
    expect(calls.consensus[0].variations).toBeGreaterThan(1);
  });
});

describe('§11/§12 resilience is not bypassed by the search-policy path', () => {
  it('reserves budget before dispatching either plane', async () => {
    for (const requiresSearch of [true, false]) {
      const { router } = harness();
      const reserved: number[] = [];
      const store = Reflect.get(router, 'budgetStore') as { reserveTask: (...args: never[]) => Promise<unknown> };
      const original = store.reserveTask.bind(store);
      store.reserveTask = async (...args: never[]) => { reserved.push(1); return original(...args); };
      await router.execute({ clientId: 'c', type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.MEDIUM, requiresSearch }, 's', 'u');
      expect(reserved).toHaveLength(1);
      expect(router.getClientBudgetReport('c')).toMatchObject({ monthSpend: 0.1, reservedSpend: 0, activeReservations: 0 });
    }
  });

  it('charges failures to the circuit of the provider the policy selected', async () => {
    const down = (provider: Provider) => new ProviderRequestError(`${provider} down`, { provider, kind: 'server', retryable: true, status: 503 });
    const failing = new L9LLMRouter(
      { perplexityApiKey: 'p', openrouterApiKey: 'o', circuitBreaker: { failureThreshold: 1 } },
      {
        openrouterClient: {
          complete: async () => response,
          completeWithVision: async () => response,
          completeWithFallback: async () => { throw down(Provider.OPENROUTER); },
        },
        perplexityClient: {
          complete: async () => { throw down(Provider.PERPLEXITY); },
          completeWithConsensus: async () => { throw down(Provider.PERPLEXITY); },
        },
      },
    );
    failing.initClient('c');

    await expect(failing.execute({ clientId: 'c', type: TaskType.COMPETITOR_RESEARCH, complexity: TaskComplexity.LOW, requiresSearch: true }, 's', 'u')).rejects.toThrow();
    expect(failing.getCircuitState(Provider.PERPLEXITY).state).toBe('open');
    expect(failing.getCircuitState(Provider.OPENROUTER).state).toBe('closed');

    await expect(failing.execute({ clientId: 'c', type: TaskType.COMPETITOR_RESEARCH, complexity: TaskComplexity.LOW, requiresSearch: false }, 's', 'u')).rejects.toThrow();
    expect(failing.getCircuitState(Provider.OPENROUTER).state).toBe('open');
  });

  it('keeps image safety validation ahead of every routing outcome', async () => {
    const { router, calls } = harness();
    await expect(router.execute(
      { clientId: 'c', type: TaskType.SCREENSHOT_ANALYSIS, complexity: TaskComplexity.MEDIUM, requiresSearch: false },
      's', 'u', { images: ['https://127.0.0.1/a.png'] },
    )).rejects.toThrow(/private/);
    expect(calls.vision).toHaveLength(0);
    expect(router.getCircuitState(Provider.OPENROUTER).failureCount).toBe(0);
  });

  it('a downgraded search route stays on the search plane', async () => {
    const { router, calls } = harness();
    await router.execute({ clientId: 'c', type: TaskType.MARKET_RESEARCH, complexity: TaskComplexity.CRITICAL }, 's', 'u');
    const logged = router.getCallLog()[0];
    expect(Object.values(SonarModel)).toContain(logged.model);
    expect(logged.searchRequired).toBe(true);
    expect(calls.general).toHaveLength(0);
  });
});

describe('§23 invalid search policy is a validation error, not a warning', () => {
  it('rejects a non-boolean requiresSearch before routing', () => {
    const { router } = harness();
    expect(() => router.route({ type: TaskType.MARKET_RESEARCH, complexity: TaskComplexity.LOW, requiresSearch: 'yes' } as never))
      .toThrow(/Invalid TaskDescriptor/);
  });

  it('still refuses application-selected provider and model fields', () => {
    const { router } = harness();
    const decision = router.route({ type: TaskType.MARKET_RESEARCH, complexity: TaskComplexity.LOW, provider: Provider.OPENROUTER, model: GeneralModel.GPT4O } as never);
    // Unknown keys are stripped by the schema; the router keeps provider authority.
    expect(decision.provider).toBe(Provider.PERPLEXITY);
    expect(Object.values(SonarModel)).toContain(decision.model);
  });
});
