/**
 * @l9_meta
 * @module @quantum-l9/llm-router
 * @file src/matrices/perplexity-matrix.ts
 * @purpose Perplexity Sonar model + search depth resolver
 * @origin Ported from Enrichment.Inference.Engine/app/engines/search_optimizer.py
 * @pattern Deterministic resolution — no LLM call needed for routing
 */
import { TaskDescriptor, PerplexityConfig } from '../types.js';
export declare function estimatePerplexityCost(config: PerplexityConfig): number;
/**
 * Resolves a TaskDescriptor into a complete PerplexityConfig.
 *
 * This is a deterministic function — no LLM call needed.
 * The routing decision is pure code based on task classification.
 */
export declare function resolvePerplexityConfig(task: TaskDescriptor): PerplexityConfig;
//# sourceMappingURL=perplexity-matrix.d.ts.map