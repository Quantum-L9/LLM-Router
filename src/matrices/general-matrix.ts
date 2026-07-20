import { GeneralModel, Provider, TaskComplexity, TaskDescriptor, TaskType } from '../types.js';
export interface GeneralModelConfig { model: GeneralModel; provider: Provider; temperature: number; maxTokens: number; responseFormat: 'json' | 'text'; estimatedCostPerCall: number; resolutionReason: string }
export function resolveGeneralConfig(task: TaskDescriptor): GeneralModelConfig {
  const model = task.complexity === TaskComplexity.CRITICAL ? GeneralModel.CLAUDE_OPUS : task.complexity === TaskComplexity.HIGH ? GeneralModel.CLAUDE_SONNET : GeneralModel.GPT4O_MINI;
  const responseFormat = [TaskType.CLASSIFICATION, TaskType.EXTRACTION, TaskType.SCORING].includes(task.type) ? 'json' : 'text';
  return { model, provider: Provider.OPENROUTER, temperature: responseFormat === 'json' ? 0.1 : 0.3, maxTokens: task.expectedOutputTokens ?? 2048, responseFormat, estimatedCostPerCall: 0.01, resolutionReason: `${task.type}:${task.complexity}` };
}
export function getFallbackChain(): GeneralModel[] { return [GeneralModel.GPT4O_MINI]; }
