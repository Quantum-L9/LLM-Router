import { Provider, SonarModel, TaskComplexity, TaskDescriptor } from '../types.js';
export interface PerplexityConfig { model: SonarModel; provider: Provider; temperature: number; maxTokens: number; variations: number; disableSearch: boolean; estimatedCostPerCall: number; resolutionReason: string }
export function resolvePerplexityConfig(task: TaskDescriptor): PerplexityConfig {
  const model = task.complexity === TaskComplexity.CRITICAL ? SonarModel.SONAR_DEEP_RESEARCH : task.complexity === TaskComplexity.HIGH ? SonarModel.SONAR_REASONING_PRO : SonarModel.SONAR_PRO;
  return { model, provider: Provider.PERPLEXITY, temperature: 0.2, maxTokens: task.expectedOutputTokens ?? 2048, variations: task.complexity === TaskComplexity.CRITICAL ? 5 : 1, disableSearch: task.requiresSearch === false, estimatedCostPerCall: 0.02, resolutionReason: `${task.type}:${task.complexity}` };
}
