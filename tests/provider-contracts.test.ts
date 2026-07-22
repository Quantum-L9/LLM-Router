import { describe, expect, it } from 'vitest';
import { OpenRouterClient } from '../src/providers/openrouter.js';
import { PerplexityClient, buildRequestBody } from '../src/providers/perplexity.js';
import { ProviderRequestError } from '../src/provider-errors.js';
import { GeneralModel, MessageStrategy, Provider, RecencyFilter, SearchContextSize, SearchMode, SonarModel, type GeneralModelConfig, type PerplexityConfig } from '../src/types.js';
import type { ChatCompletionRequest, ChatCompletionResult, ChatTransport } from '../src/providers/openai-transport.js';

class CapturingTransport implements ChatTransport {
  requests: ChatCompletionRequest[] = [];
  constructor(private readonly result: ChatCompletionResult = { id: 'req', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) {}
  async create(request: ChatCompletionRequest): Promise<ChatCompletionResult> { this.requests.push(request); return this.result; }
}

class ScriptedTransport implements ChatTransport {
  requests: ChatCompletionRequest[] = [];
  constructor(private readonly outcomes: Array<ChatCompletionResult | unknown>) {}
  async create(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.requests.push(request);
    const outcome = this.outcomes.shift();
    if (outcome instanceof Error || (outcome && typeof outcome === 'object' && ('status' in outcome || 'code' in outcome))) throw outcome;
    if (!outcome) throw new Error('Scripted transport exhausted');
    return outcome as ChatCompletionResult;
  }
}

const general: GeneralModelConfig = { model: GeneralModel.GPT4O_MINI, provider: Provider.OPENROUTER, temperature: 0.1, maxTokens: 100, responseFormat: 'json', estimatedCostPerCall: 0.01, resolutionReason: 'test' };
const perplexity: PerplexityConfig = { model: SonarModel.SONAR_PRO, searchContextSize: SearchContextSize.HIGH, searchMode: SearchMode.WEB, recencyFilter: RecencyFilter.WEEK, messageStrategy: MessageStrategy.SYSTEM_USER, temperature: 0.2, maxTokens: 100, domainFilter: ['example.com'], variations: 1, disableSearch: false, estimatedCostPerCall: 0.01, resolutionReason: 'test' };

describe('provider transport contracts', () => {
  it('preserves OpenRouter JSON request shape and usage', async () => {
    const transport = new CapturingTransport();
    const client = new OpenRouterClient('key', 'app', 1000, transport);
    const result = await client.complete(general, 'system', 'user');
    expect(transport.requests[0]).toMatchObject({ model: 'openai/gpt-4o-mini', response_format: { type: 'json_object' }, max_tokens: 100 });
    expect(result).toMatchObject({ content: 'ok', inputTokens: 10, outputTokens: 5, totalTokens: 15, requestId: 'req' });
  });

  it('preserves OpenRouter vision content', async () => {
    const transport = new CapturingTransport();
    const client = new OpenRouterClient('key', 'app', 1000, transport);
    await client.completeWithVision({ model: GeneralModel.GPT4O, provider: Provider.OPENROUTER, maxTokens: 100, detail: 'high', estimatedCostPerCall: 0.01, resolutionReason: 'test' }, 'system', 'user', ['https://cdn.example.com/a.png']);
    expect(transport.requests[0].messages[1].content).toEqual([{ type: 'text', text: 'user' }, { type: 'image_url', image_url: { url: 'https://cdn.example.com/a.png', detail: 'high' } }]);
  });

  it('keeps Perplexity search extensions outside SDK types', async () => {
    const transport = new CapturingTransport({ id: 'p', citations: ['https://example.com'], choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } });
    const client = new PerplexityClient('key', 1000, transport);
    const result = await client.complete(perplexity, 'system', 'user');
    expect(transport.requests[0]).toMatchObject({ web_search_options: { search_context_size: 'high', search_recency_filter: 'week', search_domain_filter: ['example.com'] } });
    expect(result.citations).toEqual(['https://example.com']);
  });

  it('omits web search options when search is disabled', () => {
    const body = buildRequestBody({ ...perplexity, disableSearch: true }, []);
    expect(body).not.toHaveProperty('web_search_options');
  });

  it('falls back only after retryable OpenRouter failures', async () => {
    const transport = new ScriptedTransport([
      { status: 503, message: 'temporary outage' },
      { id: 'ok', choices: [{ message: { content: 'fallback' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    ]);
    const client = new OpenRouterClient('key', 'app', 1000, transport);
    const result = await client.completeWithFallback(general, [GeneralModel.GEMINI_FLASH], 'system', 'user');
    expect(result.content).toBe('fallback');
    expect(transport.requests.map(request => request.model)).toEqual(['openai/gpt-4o-mini', 'google/gemini-2.5-flash']);
  });

  it('does not retry non-retryable or cancelled OpenRouter failures', async () => {
    const clientErrorTransport = new ScriptedTransport([{ status: 400, message: 'invalid request' }]);
    const client = new OpenRouterClient('key', 'app', 1000, clientErrorTransport);
    await expect(client.completeWithFallback(general, [GeneralModel.GEMINI_FLASH], 'system', 'user')).rejects.toMatchObject({ kind: 'client', retryable: false });
    expect(clientErrorTransport.requests).toHaveLength(1);

    const abortedTransport = new ScriptedTransport([]);
    const abortedClient = new OpenRouterClient('key', 'app', 1000, abortedTransport);
    const controller = new AbortController();
    controller.abort('cancelled by caller');
    await expect(abortedClient.completeWithFallback(general, [GeneralModel.GEMINI_FLASH], 'system', 'user', controller.signal)).rejects.toMatchObject({ kind: 'cancelled', retryable: false });
    expect(abortedTransport.requests).toHaveLength(0);
  });

  it('reports aggregate consensus usage and cost', async () => {
    const transport = new ScriptedTransport([
      { id: 'a', choices: [{ message: { content: 'one' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, citations: ['https://a.example'] },
      { id: 'b', choices: [{ message: { content: 'a longer answer' } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }, citations: ['https://b.example'] },
      { id: 'c', choices: [{ message: { content: 'three' } }], usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 }, citations: ['https://a.example'] },
    ]);
    const client = new PerplexityClient('key', 1000, transport);
    const result = await client.completeWithConsensus({ ...perplexity, variations: 3 }, 'system', 'user');
    expect(result.best.content).toBe('a longer answer');
    expect(result.aggregate).toMatchObject({ inputTokens: 60, outputTokens: 30, totalTokens: 90 });
    expect(result.aggregate.cost).toBeCloseTo(result.all.reduce((total, response) => total + response.cost, 0));
    expect(result.aggregate.citations).toEqual(['https://a.example', 'https://b.example']);
  });

  it('preserves terminal consensus failure classification', async () => {
    const transport = new ScriptedTransport([{ status: 400, message: 'bad' }, { status: 400, message: 'bad' }]);
    const client = new PerplexityClient('key', 1000, transport);
    const failure = client.completeWithConsensus({ ...perplexity, variations: 2 }, 'system', 'user');
    await expect(failure).rejects.toBeInstanceOf(ProviderRequestError);
    await expect(failure).rejects.toMatchObject({ kind: 'client', retryable: false });
  });

  it('bounds direct consensus fan-out', async () => {
    const transport = new ScriptedTransport([]);
    const client = new PerplexityClient('key', 1000, transport);
    await expect(client.completeWithConsensus({ ...perplexity, variations: 6 }, 'system', 'user')).rejects.toMatchObject({ kind: 'local', code: 'INVALID_VARIATION_COUNT' });
    expect(transport.requests).toHaveLength(0);
  });
});
