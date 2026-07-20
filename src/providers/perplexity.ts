import { Provider, type LLMResponse } from '../types.js';
export class PerplexityClient { constructor(_apiKey: string) {} async complete(config: {model: string}, _system: string, _user: string): Promise<LLMResponse> { return { content: '', model: config.model, provider: Provider.PERPLEXITY, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, latencyMs: 0, cached: false }; } }
