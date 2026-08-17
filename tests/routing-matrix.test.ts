import { describe, expect, it } from 'vitest';
import {
  L9LLMRouter,
  UnsupportedCapabilityCombinationError,
  requiresSearchProvider,
  resolveRoute,
} from '../src/index.js';
import { resolvePerplexityConfig } from '../src/matrices/perplexity-matrix.js';
import { buildRequestBody } from '../src/providers/perplexity.js';
import {
  GeneralModel,
  Provider,
  TaskComplexity,
  TaskType,
  type GeneralModelConfig,
  type LLMResponse,
  type PerplexityConfig,
  type TaskDescriptor,
  type VisionConfig,
} from '../src/types.js';

const IMAGES = ['https://cdn.example.com/screenshot.png'];

const base = (over: Partial<TaskDescriptor>): TaskDescriptor => ({
  type: TaskType.CLASSIFICATION,
  complexity: TaskComplexity.MEDIUM,
  clientId: 'client',
  ...over,
});

describe('routing matrix — explicit requiresSearch is authoritative', () => {
  const matrix: Array<{ name: string; task: TaskDescriptor; expected: Provider | 'conflict' }> = [
    { name: 'A. STRATEGIC_REASONING + false → NON_SEARCH', task: base({ type: TaskType.STRATEGIC_REASONING, requiresSearch: false }), expected: Provider.OPENROUTER },
    { name: 'B. STRATEGIC_REASONING + true → SEARCH', task: base({ type: TaskType.STRATEGIC_REASONING, requiresSearch: true }), expected: Provider.PERPLEXITY },
    { name: 'C. STRATEGIC_REASONING + undefined → NON_SEARCH', task: base({ type: TaskType.STRATEGIC_REASONING }), expected: Provider.OPENROUTER },
    { name: 'D. COMPETITOR_RESEARCH + true → SEARCH', task: base({ type: TaskType.COMPETITOR_RESEARCH, requiresSearch: true }), expected: Provider.PERPLEXITY },
    { name: 'E. COMPETITOR_RESEARCH + false → NON_SEARCH', task: base({ type: TaskType.COMPETITOR_RESEARCH, requiresSearch: false }), expected: Provider.OPENROUTER },
    { name: 'F. COMPETITOR_RESEARCH + undefined → SEARCH', task: base({ type: TaskType.COMPETITOR_RESEARCH }), expected: Provider.PERPLEXITY },
    { name: 'G. FACT_VERIFICATION + false → NON_SEARCH', task: base({ type: TaskType.FACT_VERIFICATION, requiresSearch: false }), expected: Provider.OPENROUTER },
    { name: 'H. FACT_VERIFICATION + undefined → SEARCH', task: base({ type: TaskType.FACT_VERIFICATION }), expected: Provider.PERPLEXITY },
    { name: 'I. CONTENT_GENERATION + false → NON_SEARCH', task: base({ type: TaskType.CONTENT_GENERATION, requiresSearch: false }), expected: Provider.OPENROUTER },
    { name: 'J. CONTENT_GENERATION + true → SEARCH', task: base({ type: TaskType.CONTENT_GENERATION, requiresSearch: true }), expected: Provider.PERPLEXITY },
    { name: 'K. SCREENSHOT_ANALYSIS + images + false → VISION', task: base({ type: TaskType.SCREENSHOT_ANALYSIS, images: IMAGES, requiresSearch: false }), expected: Provider.OPENROUTER },
    { name: 'L. SCREENSHOT_ANALYSIS + images + undefined → VISION', task: base({ type: TaskType.SCREENSHOT_ANALYSIS, images: IMAGES }), expected: Provider.OPENROUTER },
    { name: 'M. SCREENSHOT_ANALYSIS + images + true → fail closed', task: base({ type: TaskType.SCREENSHOT_ANALYSIS, images: IMAGES, requiresSearch: true }), expected: 'conflict' },
  ];

  it.each(matrix)('$name', ({ task, expected }) => {
    if (expected === 'conflict') {
      expect(() => resolveRoute(task)).toThrow(UnsupportedCapabilityCombinationError);
      return;
    }
    expect(resolveRoute(task).provider).toBe(expected);
  });
});

describe('routing audit evidence', () => {
  it('explicit requiresSearch=false → searchRequired=false + EXPLICIT', () => {
    const decision = resolveRoute(base({ type: TaskType.COMPETITOR_RESEARCH, requiresSearch: false }));
    expect(decision).toMatchObject({ searchRequired: false, searchPolicySource: 'EXPLICIT', provider: Provider.OPENROUTER });
  });

  it('explicit requiresSearch=true → searchRequired=true + EXPLICIT', () => {
    const decision = resolveRoute(base({ type: TaskType.STRATEGIC_REASONING, requiresSearch: true }));
    expect(decision).toMatchObject({ searchRequired: true, searchPolicySource: 'EXPLICIT', provider: Provider.PERPLEXITY });
  });

  it('omitted flag on a default-search task → TASK_DEFAULT', () => {
    const decision = resolveRoute(base({ type: TaskType.MARKET_RESEARCH }));
    expect(decision).toMatchObject({ searchRequired: true, searchPolicySource: 'TASK_DEFAULT' });
  });

  it('omitted flag on a general task → TASK_DEFAULT', () => {
    const decision = resolveRoute(base({ type: TaskType.STRATEGIC_REASONING }));
    expect(decision).toMatchObject({ searchRequired: false, searchPolicySource: 'TASK_DEFAULT' });
  });

  it('call log carries the resolved search policy and dispatched provider/model', async () => {
    let selectedModel: GeneralModel | undefined;
    const capturingOpenRouter = {
      ...fakeOpenRouter,
      completeWithFallback: async (config: GeneralModelConfig) => {
        selectedModel = config.model;
        return { ...response, model: config.model };
      },
    };
    const router = new L9LLMRouter({ perplexityApiKey: 'p', openrouterApiKey: 'o' }, { openrouterClient: capturingOpenRouter, perplexityClient: fakePerplexity });
    router.initClient('client');
    const result = await router.execute(base({ type: TaskType.STRATEGIC_REASONING, requiresSearch: false }), 's', 'u');
    const entry = router.getCallLog()[0];
    expect(entry).toMatchObject({
      searchRequired: false,
      searchPolicySource: 'EXPLICIT',
      provider: Provider.OPENROUTER,
      model: selectedModel,
      actualCost: result.cost,
      latencyMs: result.latencyMs,
    });
  });
});

describe('provider dispatch — explicit search policy selects the right client', () => {
  it('requiresSearch=true calls the search client and never the general client', async () => {
    const { perplexityCalls, openrouterCalls, router } = makeCountingRouter();
    router.initClient('client');
    await router.execute(base({ type: TaskType.STRATEGIC_REASONING, requiresSearch: true }), 's', 'u');
    expect(perplexityCalls()).toBe(1);
    expect(openrouterCalls()).toBe(0);
  });

  it('requiresSearch=false on a default-search TaskType calls the general client and never the search client', async () => {
    const { perplexityCalls, openrouterCalls, router } = makeCountingRouter();
    router.initClient('client');
    await router.execute(base({ type: TaskType.COMPETITOR_RESEARCH, requiresSearch: false }), 's', 'u');
    expect(openrouterCalls()).toBe(1);
    expect(perplexityCalls()).toBe(0);
  });

  it('vision tasks dispatch through the vision path', async () => {
    const { perplexityCalls, visionCalls, router } = makeCountingRouter();
    router.initClient('client');
    await router.execute(base({ type: TaskType.SCREENSHOT_ANALYSIS, images: IMAGES }), 's', 'u');
    expect(visionCalls()).toBe(1);
    expect(perplexityCalls()).toBe(0);
  });

  it('unsupported search+vision fails closed with no provider dispatch and no budget leak', async () => {
    const { perplexityCalls, openrouterCalls, router } = makeCountingRouter();
    router.initClient('client');
    await expect(router.execute(base({ type: TaskType.SCREENSHOT_ANALYSIS, images: IMAGES, requiresSearch: true }), 's', 'u'))
      .rejects.toBeInstanceOf(UnsupportedCapabilityCombinationError);
    expect(perplexityCalls()).toBe(0);
    expect(openrouterCalls()).toBe(0);
    expect(router.getClientBudgetReport('client')).toMatchObject({ reservedSpend: 0, activeReservations: 0 });
    expect(router.getCircuitState(Provider.PERPLEXITY).failureCount).toBe(0);
    expect(router.getCircuitState(Provider.OPENROUTER).failureCount).toBe(0);
  });
});

describe('consensus is an execution modifier, not search-policy authority', () => {
  it('consensus=true on a non-search route neither reroutes nor errors', async () => {
    const { perplexityCalls, router } = makeCountingRouter();
    router.initClient('client');
    const result = await router.execute(base({ type: TaskType.STRATEGIC_REASONING, requiresSearch: false }), 's', 'u', { consensus: true });
    expect(result.provider).toBe(Provider.OPENROUTER);
    expect(perplexityCalls()).toBe(0);
    expect(router.getCallLog()[0]).toMatchObject({ searchRequired: false, searchPolicySource: 'EXPLICIT' });
  });
});

describe('Perplexity config agrees with the route decision', () => {
  it('never disables search for any router-selected Perplexity route', () => {
    for (const type of Object.values(TaskType)) {
      for (const requiresSearch of [true, undefined] as const) {
        const task = base({ type, requiresSearch });
        if (!requiresSearchProvider(task)) continue;
        expect(resolvePerplexityConfig(task).disableSearch, `${type} requiresSearch=${requiresSearch}`).toBe(false);
      }
    }
  });

  it('a resolved search config produces a request body with web search enabled', () => {
    const config = resolvePerplexityConfig(base({ type: TaskType.MARKET_RESEARCH }));
    const body = buildRequestBody(config, []);
    expect(body.web_search_options).toBeDefined();
  });
});

const response: LLMResponse = { content: 'ok', model: GeneralModel.GPT4O_MINI, provider: Provider.OPENROUTER, inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.1, latencyMs: 5, cached: false };
const fakeOpenRouter = {
  complete: async (_config: GeneralModelConfig) => response,
  completeWithVision: async (_config: VisionConfig) => response,
  completeWithFallback: async (_config: GeneralModelConfig) => response,
};
const fakePerplexity = {
  complete: async (_config: PerplexityConfig) => ({ ...response, provider: Provider.PERPLEXITY }),
  completeWithConsensus: async (_config: PerplexityConfig) => ({
    best: { ...response, provider: Provider.PERPLEXITY },
    all: [{ ...response, provider: Provider.PERPLEXITY }],
    consensusScore: 1,
    aggregate: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.1, latencyMs: 5, citations: [] },
  }),
};

function makeCountingRouter() {
  let perplexityCalls = 0;
  let openrouterCalls = 0;
  let visionCalls = 0;
  const countingOpenRouter = {
    complete: async (_config: GeneralModelConfig) => { openrouterCalls += 1; return response; },
    completeWithVision: async (_config: VisionConfig) => { visionCalls += 1; return response; },
    completeWithFallback: async (_config: GeneralModelConfig) => { openrouterCalls += 1; return response; },
  };
  const countingPerplexity = {
    ...fakePerplexity,
    complete: async (_config: PerplexityConfig) => { perplexityCalls += 1; return { ...response, provider: Provider.PERPLEXITY }; },
  };
  const router = new L9LLMRouter(
    { perplexityApiKey: 'p', openrouterApiKey: 'o' },
    { openrouterClient: countingOpenRouter, perplexityClient: countingPerplexity },
  );
  return { perplexityCalls: () => perplexityCalls, openrouterCalls: () => openrouterCalls, visionCalls: () => visionCalls, router };
}
