/**
 * @l9_meta
 * @module @quantum-l9/llm-router
 * @file src/providers/openrouter.ts
 * @purpose OpenRouter API client — unified gateway to GPT-4o, Claude, Gemini, etc.
 * @api https://openrouter.ai/api/v1/chat/completions
 */
import { GeneralModel, GeneralModelConfig, LLMResponse, VisionConfig } from '../types.js';
export declare class OpenRouterClient {
    private client;
    private appName;
    constructor(apiKey: string, appName?: string);
    /**
     * Execute a text completion using the resolved GeneralModelConfig.
     */
    complete(config: GeneralModelConfig, systemPrompt: string, userPrompt: string): Promise<LLMResponse>;
    /**
     * Execute a vision completion with image(s).
     */
    completeWithVision(config: VisionConfig, systemPrompt: string, userPrompt: string, imageUrls: string[]): Promise<LLMResponse>;
    /**
     * Execute with automatic fallback chain.
     */
    completeWithFallback(config: GeneralModelConfig, fallbackModels: GeneralModel[], systemPrompt: string, userPrompt: string): Promise<LLMResponse>;
    private calculateCost;
}
export declare class OpenRouterError extends Error {
    config: GeneralModelConfig;
    constructor(message: string, config: GeneralModelConfig);
}
//# sourceMappingURL=openrouter.d.ts.map