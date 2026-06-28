/**
 * @l9_meta
 * @module @quantum-l9/llm-router
 * @file src/providers/perplexity.ts
 * @purpose Perplexity API client — handles all search-grounded LLM calls
 * @api https://api.perplexity.ai/chat/completions
 */
import { PerplexityConfig, LLMResponse } from '../types.js';
export declare class PerplexityClient {
    private client;
    constructor(apiKey: string);
    /**
     * Execute a search-grounded completion using the resolved PerplexityConfig.
     */
    complete(config: PerplexityConfig, systemPrompt: string, userPrompt: string, assistantContext?: string): Promise<LLMResponse>;
    /**
     * Execute with consensus mode (multiple variations).
     * Returns the best response based on consistency.
     */
    completeWithConsensus(config: PerplexityConfig, systemPrompt: string, userPrompt: string, assistantContext?: string): Promise<{
        best: LLMResponse;
        all: LLMResponse[];
        consensusScore: number;
    }>;
    private calculateActualCost;
}
export declare class PerplexityError extends Error {
    config: PerplexityConfig;
    constructor(message: string, config: PerplexityConfig);
}
//# sourceMappingURL=perplexity.d.ts.map