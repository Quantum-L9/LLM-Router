import { classifyProviderError, ProviderRequestError, throwIfAborted } from '../provider-errors.js';
import {
  MessageStrategy,
  Provider,
  SonarModel,
  type LLMResponse,
  type PerplexityConfig,
} from '../types.js';
import { OpenAIChatTransport, type ChatMessage, type ChatTransport } from './openai-transport.js';

export interface PerplexityClientLike {
  complete(config: PerplexityConfig, systemPrompt: string, userPrompt: string, assistantContext?: string, signal?: AbortSignal): Promise<LLMResponse>;
  completeWithConsensus(config: PerplexityConfig, systemPrompt: string, userPrompt: string, assistantContext?: string, signal?: AbortSignal): Promise<PerplexityConsensusResult>;
}

export interface PerplexityConsensusResult {
  best: LLMResponse;
  all: LLMResponse[];
  consensusScore: number;
  aggregate: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    latencyMs: number;
    citations: string[];
  };
}

export function buildRequestBody(config: PerplexityConfig, messages: ChatMessage[]): Record<string, unknown> {
  const body: Record<string, unknown> = { model: config.model, messages, temperature: config.temperature, max_tokens: config.maxTokens };
  if (!config.disableSearch) {
    const web: Record<string, unknown> = { search_context_size: config.searchContextSize };
    if (config.recencyFilter !== 'none') web.search_recency_filter = config.recencyFilter;
    if (config.domainFilter.length > 0) web.search_domain_filter = config.domainFilter;
    body.web_search_options = web;
  }
  if (config.searchMode !== 'web') body.search_mode = config.searchMode;
  if (config.reasoningEffort && [SonarModel.SONAR_REASONING, SonarModel.SONAR_REASONING_PRO].includes(config.model)) body.reasoning_effort = config.reasoningEffort;
  return body;
}

export class PerplexityClient implements PerplexityClientLike {
  private readonly transport: ChatTransport;
  constructor(apiKey: string, timeoutMs = 60_000, transport?: ChatTransport) {
    this.transport = transport ?? new OpenAIChatTransport({ apiKey, baseURL: 'https://api.perplexity.ai', timeoutMs, maxRetries: 0 });
  }

  async complete(config: PerplexityConfig, systemPrompt: string, userPrompt: string, assistantContext?: string, signal?: AbortSignal): Promise<LLMResponse> {
    throwIfAborted(signal, Provider.PERPLEXITY);
    const started = Date.now();
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    if (config.messageStrategy === MessageStrategy.SYSTEM_USER_ASSISTANT && assistantContext) messages.push({ role: 'assistant', content: assistantContext });
    messages.push({ role: 'user', content: userPrompt });
    try {
      const response = await this.transport.create(buildRequestBody(config, messages) as never, { signal });
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const rates = config.model === SonarModel.SONAR ? { input: 0.001, output: 0.001 } : { input: 0.003, output: 0.015 };
      return { content: response.choices[0]?.message?.content ?? '', model: config.model, provider: Provider.PERPLEXITY, inputTokens, outputTokens, totalTokens: response.usage?.total_tokens ?? inputTokens + outputTokens, cost: response.usage ? Math.round(((inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output) * 100000) / 100000 : config.estimatedCostPerCall, latencyMs: Date.now() - started, cached: false, citations: response.citations, requestId: response._request_id ?? response.id, finishReason: response.choices[0]?.finish_reason ?? undefined };
    } catch (error) { throw classifyProviderError(error, Provider.PERPLEXITY); }
  }

  async completeWithConsensus(config: PerplexityConfig, systemPrompt: string, userPrompt: string, assistantContext?: string, signal?: AbortSignal): Promise<PerplexityConsensusResult> {
    throwIfAborted(signal, Provider.PERPLEXITY);
    if (!Number.isInteger(config.variations) || config.variations < 1 || config.variations > 5) {
      throw new ProviderRequestError('Perplexity consensus variations must be an integer between 1 and 5', {
        provider: Provider.PERPLEXITY,
        kind: 'local',
        retryable: false,
        code: 'INVALID_VARIATION_COUNT',
      });
    }
    if (config.variations <= 1) {
      const result = await this.complete(config, systemPrompt, userPrompt, assistantContext, signal);
      return { best: result, all: [result], consensusScore: 1, aggregate: aggregateResponses([result]) };
    }
    const settled = await Promise.allSettled(Array.from({ length: config.variations }, () => this.complete(config, systemPrompt, userPrompt, assistantContext, signal)));
    const successes = settled.filter((entry): entry is PromiseFulfilledResult<LLMResponse> => entry.status === 'fulfilled').map(entry => entry.value);
    if (successes.length === 0) {
      throwIfAborted(signal, Provider.PERPLEXITY);
      const failures = settled
        .filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
        .map(entry => classifyProviderError(entry.reason, Provider.PERPLEXITY));
      const terminal = failures.find(failure => !failure.retryable || failure.kind === 'cancelled');
      if (terminal) throw terminal;
      throw new ProviderRequestError('All Perplexity consensus variations failed', {
        provider: Provider.PERPLEXITY,
        kind: failures.at(-1)?.kind ?? 'unknown',
        retryable: failures.some(failure => failure.retryable),
        code: 'ALL_CONSENSUS_FAILED',
        cause: failures,
      });
    }
    return {
      best: successes.reduce((best, candidate) => candidate.content.length > best.content.length ? candidate : best),
      all: successes,
      consensusScore: successes.length / config.variations,
      aggregate: aggregateResponses(successes),
    };
  }
}

function aggregateResponses(responses: LLMResponse[]): PerplexityConsensusResult['aggregate'] {
  return {
    inputTokens: responses.reduce((total, response) => total + response.inputTokens, 0),
    outputTokens: responses.reduce((total, response) => total + response.outputTokens, 0),
    totalTokens: responses.reduce((total, response) => total + response.totalTokens, 0),
    cost: Math.round(responses.reduce((total, response) => total + response.cost, 0) * 1_000_000) / 1_000_000,
    latencyMs: Math.max(...responses.map(response => response.latencyMs)),
    citations: [...new Set(responses.flatMap(response => response.citations ?? []))].sort(),
  };
}

/** @deprecated Direct provider access bypasses router budget and circuit controls. */
export class PerplexityError extends ProviderRequestError {}
