import { calculateOpenRouterCost } from '../pricing.js';
import { classifyProviderError, ProviderRequestError, throwIfAborted } from '../provider-errors.js';
import {
  Provider,
  type GeneralModel,
  type GeneralModelConfig,
  type LLMResponse,
  type VisionConfig,
} from '../types.js';
import {
  OpenAIChatTransport,
  type ChatContentPart,
  type ChatMessage,
  type ChatTransport,
} from './openai-transport.js';
import { GeneralModel as GeneralModelValue } from '../types.js';

const MODEL_IDS: Record<GeneralModel, string> = {
  [GeneralModelValue.GPT4O_MINI]: 'openai/gpt-4o-mini',
  [GeneralModelValue.GEMINI_FLASH]: 'google/gemini-2.5-flash',
  [GeneralModelValue.CLAUDE_HAIKU]: 'anthropic/claude-haiku-4',
  [GeneralModelValue.GPT4O]: 'openai/gpt-4o',
  [GeneralModelValue.CLAUDE_SONNET]: 'anthropic/claude-sonnet-4',
  [GeneralModelValue.GEMINI_PRO]: 'google/gemini-2.5-pro',
  [GeneralModelValue.CLAUDE_OPUS]: 'anthropic/claude-opus-4',
  [GeneralModelValue.O1]: 'openai/o1',
  [GeneralModelValue.O3]: 'openai/o3',
};

const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
const SAFE_DATA_URI = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i;

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return false;
  const values = parts.map(Number);
  if (values.some(value => value < 0 || value > 255)) return false;
  const [a, b] = values;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function mappedIpv4FromIpv6(hostname: string): string | undefined {
  const normalized = hostname.toLowerCase();
  const dotted = normalized.match(/^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = normalized.match(/^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return undefined;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!normalized.includes(':')) return false;
  if (normalized === '::' || normalized === '::1') return true;
  const mapped = mappedIpv4FromIpv6(normalized);
  if (mapped) return isPrivateIpv4(mapped);
  const firstText = normalized.split(':').find(Boolean);
  if (!firstText) return true;
  const first = Number.parseInt(firstText, 16);
  if (!Number.isFinite(first)) return true;
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

export class UnsafeImageUrlError extends Error {
  constructor(message: string, public readonly url: string) { super(message); this.name = 'UnsafeImageUrlError'; }
  toJSON(): Record<string, unknown> { return { name: this.name, message: this.message }; }
}

export function validateImageUrl(url: string): void {
  if (url.startsWith('data:')) {
    const match = SAFE_DATA_URI.exec(url);
    if (!match) throw new UnsafeImageUrlError('Image data URI must be a supported base64 image', url);
    if (Math.floor(match[2].length * 3 / 4) > MAX_INLINE_IMAGE_BYTES) throw new UnsafeImageUrlError('Inline image exceeds the 10 MiB limit', url);
    return;
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new UnsafeImageUrlError('Image URL must be absolute', url); }
  if (parsed.protocol !== 'https:') throw new UnsafeImageUrlError('Image URL must use HTTPS', url);
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || isPrivateIpv4(host) || isPrivateIpv6(host)) throw new UnsafeImageUrlError('Image URL targets a private, loopback, link-local, or reserved address', url);
}

export interface OpenRouterClientLike {
  complete(config: GeneralModelConfig, systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<LLMResponse>;
  completeWithVision(config: VisionConfig, systemPrompt: string, userPrompt: string, imageUrls: string[], signal?: AbortSignal): Promise<LLMResponse>;
  completeWithFallback(config: GeneralModelConfig, fallbacks: GeneralModel[], systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<LLMResponse>;
}

export class OpenRouterClient implements OpenRouterClientLike {
  private readonly transport: ChatTransport;
  constructor(apiKey: string, appName = 'L9-LLM-Router', timeoutMs = 60_000, transport?: ChatTransport) {
    this.transport = transport ?? new OpenAIChatTransport({ apiKey, baseURL: 'https://openrouter.ai/api/v1', timeoutMs, maxRetries: 0, defaultHeaders: { 'HTTP-Referer': 'https://l9.systems', 'X-Title': appName } });
  }

  async complete(config: GeneralModelConfig, systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<LLMResponse> {
    throwIfAborted(signal, Provider.OPENROUTER);
    const started = Date.now();
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }];
    try {
      const response = await this.transport.create({ model: MODEL_IDS[config.model], messages, temperature: config.temperature, max_tokens: config.maxTokens, ...(config.responseFormat === 'json' ? { response_format: { type: 'json_object' as const } } : {}) }, { signal });
      return { content: response.choices[0]?.message?.content ?? '', model: config.model, provider: Provider.OPENROUTER, inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0, totalTokens: response.usage?.total_tokens ?? 0, cost: calculateOpenRouterCost(config.model, response.usage), latencyMs: Date.now() - started, cached: false, requestId: response._request_id ?? response.id, finishReason: response.choices[0]?.finish_reason ?? undefined };
    } catch (error) { throw classifyProviderError(error, Provider.OPENROUTER); }
  }

  async completeWithVision(config: VisionConfig, systemPrompt: string, userPrompt: string, imageUrls: string[], signal?: AbortSignal): Promise<LLMResponse> {
    throwIfAborted(signal, Provider.OPENROUTER);
    for (const url of imageUrls) validateImageUrl(url);
    const started = Date.now();
    const content: ChatContentPart[] = [{ type: 'text', text: userPrompt }, ...imageUrls.map(url => ({ type: 'image_url' as const, image_url: { url, detail: config.detail } }))];
    try {
      const response = await this.transport.create({ model: MODEL_IDS[config.model], messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content }], temperature: 0.2, max_tokens: config.maxTokens }, { signal });
      return { content: response.choices[0]?.message?.content ?? '', model: config.model, provider: Provider.OPENROUTER, inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0, totalTokens: response.usage?.total_tokens ?? 0, cost: calculateOpenRouterCost(config.model, response.usage), latencyMs: Date.now() - started, cached: false, requestId: response._request_id ?? response.id, finishReason: response.choices[0]?.finish_reason ?? undefined };
    } catch (error) { throw classifyProviderError(error, Provider.OPENROUTER); }
  }

  async completeWithFallback(config: GeneralModelConfig, fallbacks: GeneralModel[], systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<LLMResponse> {
    const attempts = [...new Set([config.model, ...fallbacks])];
    const errors: ProviderRequestError[] = [];
    for (const model of attempts) {
      throwIfAborted(signal, Provider.OPENROUTER);
      try { return await this.complete({ ...config, model }, systemPrompt, userPrompt, signal); }
      catch (error) {
        const classified = classifyProviderError(error, Provider.OPENROUTER);
        errors.push(classified);
        if (!classified.retryable || classified.kind === 'cancelled') throw classified;
      }
    }
    throw new ProviderRequestError('All OpenRouter fallback attempts failed', {
      provider: Provider.OPENROUTER,
      kind: errors.at(-1)?.kind ?? 'unknown',
      retryable: errors.some(error => error.retryable),
      code: 'ALL_FALLBACKS_FAILED',
      cause: errors,
    });
  }
}

/** @deprecated Direct provider access bypasses router budget and circuit controls. */
export class OpenRouterError extends ProviderRequestError {}
