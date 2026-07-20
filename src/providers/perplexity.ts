import OpenAI from 'openai';
import { classifyProviderError, ProviderRequestError } from '../provider-errors.js';
import {
  MessageStrategy,
  Provider,
  SonarModel,
  type LLMResponse,
  type PerplexityConfig,
} from '../types.js';

export interface PerplexityClientLike {
  complete(config: PerplexityConfig, systemPrompt: string, userPrompt: string, assistantContext?: string, signal?: AbortSignal): Promise<LLMResponse>;
  completeWithConsensus(config: PerplexityConfig, systemPrompt: string, userPrompt: string, assistantContext?: string, signal?: AbortSignal): Promise<{ best: LLMResponse; all: LLMResponse[]; consensusScore: number }>;
}

export function buildRequestBody(config: PerplexityConfig, messages: OpenAI.Chat.ChatCompletionMessageParam[]): Record<string, unknown> {
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
  private readonly client: OpenAI;
  constructor(apiKey: string, timeoutMs = 60_000) { this.client = new OpenAI({ apiKey, baseURL: 'https://api.perplexity.ai', timeout: timeoutMs, maxRetries: 0 }); }

  async complete(config: PerplexityConfig, systemPrompt: string, userPrompt: string, assistantContext?: string, signal?: AbortSignal): Promise<LLMResponse> {
    const started = Date.now();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }];
    if (config.messageStrategy === MessageStrategy.SYSTEM_USER_ASSISTANT && assistantContext) messages.push({ role: 'assistant', content: assistantContext });
    messages.push({ role: 'user', content: userPrompt });
    try {
      const response = await this.client.chat.completions.create(buildRequestBody(config, messages) as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { signal });
      const citations = (response as unknown as { citations?: string[] }).citations;
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const rates = config.model === SonarModel.SONAR ? { input: 0.001, output: 0.001 } : { input: 0.003, output: 0.015 };
      return { content: response.choices[0]?.message?.content ?? '', model: config.model, provider: Provider.PERPLEXITY, inputTokens, outputTokens, totalTokens: response.usage?.total_tokens ?? inputTokens + outputTokens, cost: response.usage ? Math.round(((inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output) * 100000) / 100000 : config.estimatedCostPerCall, latencyMs: Date.now() - started, cached: false, citations, requestId: response._request_id ?? undefined, finishReason: response.choices[0]?.finish_reason ?? undefined };
    } catch (error) { throw classifyProviderError(error, Provider.PERPLEXITY); }
  }

  async completeWithConsensus(config: PerplexityConfig, systemPrompt: string, userPrompt: string, assistantContext?: string, signal?: AbortSignal): Promise<{ best: LLMResponse; all: LLMResponse[]; consensusScore: number }> {
    if (config.variations <= 1) { const result = await this.complete(config, systemPrompt, userPrompt, assistantContext, signal); return { best: result, all: [result], consensusScore: 1 }; }
    const settled = await Promise.allSettled(Array.from({ length: config.variations }, () => this.complete(config, systemPrompt, userPrompt, assistantContext, signal)));
    const successes = settled.filter((entry): entry is PromiseFulfilledResult<LLMResponse> => entry.status === 'fulfilled').map(entry => entry.value);
    if (successes.length === 0) throw new ProviderRequestError('All Perplexity consensus variations failed', { provider: Provider.PERPLEXITY, kind: 'server', retryable: true, cause: settled });
    return { best: successes.reduce((best, candidate) => candidate.content.length > best.content.length ? candidate : best), all: successes, consensusScore: successes.length / config.variations };
  }
}

/** @deprecated Direct provider access bypasses router budget and circuit controls. */
export class PerplexityError extends ProviderRequestError {}
