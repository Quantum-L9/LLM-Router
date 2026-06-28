/**
 * @l9_meta
 * @module @quantum-l9/llm-router
 * @file src/matrices/general-matrix.ts
 * @purpose General-purpose model selection matrix for non-search tasks
 * @providers OpenRouter (primary), Anthropic Direct (fallback), OpenAI Direct (fallback)
 * @pattern Task complexity × Task type → Model + Provider
 */
import { GeneralModel, TaskDescriptor, GeneralModelConfig } from '../types.js';
export declare function estimateGeneralCost(model: GeneralModel, maxTokens: number): number;
/**
 * Resolves a TaskDescriptor into a GeneralModelConfig.
 * Deterministic — no LLM call needed for routing.
 */
export declare function resolveGeneralConfig(task: TaskDescriptor): GeneralModelConfig;
/**
 * Get fallback models for a given primary model.
 */
export declare function getFallbackChain(model: GeneralModel): GeneralModel[];
//# sourceMappingURL=general-matrix.d.ts.map