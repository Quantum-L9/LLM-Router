import { describe, expect, it } from 'vitest';
import { BudgetExhaustedError, L9LLMRouter } from '../src/index.js';
import { ProviderRequestError } from '../src/provider-errors.js';
import { GeneralModel, Provider, TaskComplexity, TaskType, type GeneralModelConfig, type LLMResponse, type PerplexityConfig, type VisionConfig } from '../src/types.js';

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

describe('router execution', () => {
  it('reserves then reconciles provider cost', async () => {
    const router = new L9LLMRouter({ perplexityApiKey: 'p', openrouterApiKey: 'o' }, { openrouterClient: fakeOpenRouter, perplexityClient: fakePerplexity, idFactory: () => 'id' });
    router.initClient('a');
    await expect(router.execute({ clientId: 'a', type: TaskType.CLASSIFICATION, complexity: TaskComplexity.LOW }, 's', 'u')).resolves.toMatchObject({ content: 'ok' });
    expect(router.getClientBudgetReport('a')).toMatchObject({ monthSpend: 0.1, reservedSpend: 0, activeReservations: 0 });
  });

  it('does not poison circuit state for local validation failures', async () => {
    const router = new L9LLMRouter({ perplexityApiKey: 'p', openrouterApiKey: 'o' }, { openrouterClient: fakeOpenRouter, perplexityClient: fakePerplexity });
    router.initClient('a');
    await expect(router.execute({ clientId: 'a', type: TaskType.VISUAL_QA, complexity: TaskComplexity.MEDIUM }, 's', 'u', { images: ['https://127.0.0.1/a.png'] })).rejects.toThrow(/private/);
    expect(router.getCircuitState(Provider.OPENROUTER).failureCount).toBe(0);
  });

  it('records retryable provider failures', async () => {
    const failing = { ...fakeOpenRouter, completeWithFallback: async () => { throw new ProviderRequestError('down', { provider: Provider.OPENROUTER, kind: 'server', retryable: true, status: 503 }); } };
    const router = new L9LLMRouter({ perplexityApiKey: 'p', openrouterApiKey: 'o', circuitBreaker: { failureThreshold: 1 } }, { openrouterClient: failing, perplexityClient: fakePerplexity });
    router.initClient('a');
    await expect(router.execute({ clientId: 'a', type: TaskType.CLASSIFICATION, complexity: TaskComplexity.LOW }, 's', 'u')).rejects.toThrow(/down/);
    expect(router.getCircuitState(Provider.OPENROUTER).state).toBe('open');
    expect(router.getClientBudgetReport('a').reservedSpend).toBe(0);
  });

  it('rejects a missing client ID before allocating request identity', async () => {
    let idsAllocated = 0;
    const router = new L9LLMRouter(
      { perplexityApiKey: 'p', openrouterApiKey: 'o' },
      { openrouterClient: fakeOpenRouter, perplexityClient: fakePerplexity, idFactory: () => `id-${++idsAllocated}` },
    );
    await expect(router.execute({ type: TaskType.CLASSIFICATION, complexity: TaskComplexity.LOW }, 's', 'u')).rejects.toThrow(/clientId/);
    expect(idsAllocated).toBe(0);
  });

  it('uses option-supplied images for route selection and budget estimation', async () => {
    let selectedModel: GeneralModel | undefined;
    const capturingOpenRouter = {
      ...fakeOpenRouter,
      completeWithVision: async (config: VisionConfig) => {
        selectedModel = config.model;
        return { ...response, model: config.model };
      },
    };
    const router = new L9LLMRouter({ perplexityApiKey: 'p', openrouterApiKey: 'o' }, { openrouterClient: capturingOpenRouter, perplexityClient: fakePerplexity });
    router.initClient('a');
    await router.execute(
      { clientId: 'a', type: TaskType.SCREENSHOT_ANALYSIS, complexity: TaskComplexity.MEDIUM },
      's',
      'u',
      { images: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'] },
    );
    expect(selectedModel).toBe(GeneralModel.CLAUDE_SONNET_VISION);
    expect(router.getCallLog()[0]).toMatchObject({ model: GeneralModel.CLAUDE_SONNET_VISION, estimatedCost: 0.03 });
  });

  it('reconciles the aggregate cost of consensus execution', async () => {
    const consensusPerplexity = {
      ...fakePerplexity,
      completeWithConsensus: async (_config: PerplexityConfig) => ({
        best: { ...response, provider: Provider.PERPLEXITY, cost: 0.1 },
        all: [],
        consensusScore: 1,
        aggregate: { inputTokens: 30, outputTokens: 15, totalTokens: 45, cost: 0.6, latencyMs: 20, citations: ['https://example.com'] },
      }),
    };
    const router = new L9LLMRouter({ perplexityApiKey: 'p', openrouterApiKey: 'o' }, { openrouterClient: fakeOpenRouter, perplexityClient: consensusPerplexity });
    router.initClient('a');
    const result = await router.execute({ clientId: 'a', type: TaskType.MARKET_RESEARCH, complexity: TaskComplexity.HIGH }, 's', 'u', { consensus: true });
    expect(result).toMatchObject({ cost: 0.6, inputTokens: 30, outputTokens: 15, totalTokens: 45 });
    expect(router.getClientBudgetReport('a').monthSpend).toBe(0.6);
  });

  it('activates the public budget-exhausted error contract', async () => {
    let providerCalls = 0;
    const guardedOpenRouter = {
      ...fakeOpenRouter,
      completeWithFallback: async (_config: GeneralModelConfig) => {
        providerCalls += 1;
        return response;
      },
    };
    const router = new L9LLMRouter(
      {
        perplexityApiKey: 'p',
        openrouterApiKey: 'o',
        budget: { monthlyBudgetPerClient: 0.001, weeklyTarget: 0.001, weeklyHardCeiling: 0.001, globalMonthlyHardCeiling: 0.001 },
      },
      { openrouterClient: guardedOpenRouter, perplexityClient: fakePerplexity },
    );
    router.initClient('a');
    await expect(router.execute({ clientId: 'a', type: TaskType.CONTENT_GENERATION, complexity: TaskComplexity.LOW }, 's', 'u')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(providerCalls).toBe(0);
  });
});
