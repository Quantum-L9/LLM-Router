import {
  MessageStrategy,
  RecencyFilter,
  SearchContextSize,
  SearchMode,
  SonarModel,
  TaskComplexity,
  TaskType,
  complexityRank,
  type PerplexityConfig,
  type TaskDescriptor,
} from '../types.js';

const SEARCH_TASKS = new Set<TaskType>([TaskType.COMPETITOR_RESEARCH, TaskType.CITATION_CHECK, TaskType.FACT_VERIFICATION, TaskType.MARKET_RESEARCH, TaskType.LINK_PROSPECTING]);
export function isSearchTask(type: TaskType): boolean { return SEARCH_TASKS.has(type); }

export function resolvePerplexityConfig(task: TaskDescriptor): PerplexityConfig {
  const rank = complexityRank(task.complexity);
  const model = task.complexity === TaskComplexity.CRITICAL ? SonarModel.SONAR_DEEP_RESEARCH : rank >= complexityRank(TaskComplexity.HIGH) ? SonarModel.SONAR_REASONING_PRO : rank >= complexityRank(TaskComplexity.MEDIUM) ? SonarModel.SONAR_PRO : SonarModel.SONAR;
  const searchContextSize = rank >= complexityRank(TaskComplexity.HIGH) ? SearchContextSize.HIGH : rank >= complexityRank(TaskComplexity.MEDIUM) ? SearchContextSize.MEDIUM : SearchContextSize.LOW;
  const maxTokens = task.expectedOutputTokens ?? (task.complexity === TaskComplexity.CRITICAL ? 4096 : 2048);
  const variations = task.complexity === TaskComplexity.CRITICAL ? 5 : rank >= complexityRank(TaskComplexity.HIGH) ? 3 : 1;
  const estimatedCostPerCall = Math.round(maxTokens * variations * (model === SonarModel.SONAR ? 0.000001 : 0.000004) * 100000) / 100000;
  return {
    model,
    searchContextSize,
    searchMode: SearchMode.WEB,
    recencyFilter: task.recency ?? (task.type === TaskType.COMPETITOR_RESEARCH ? RecencyFilter.WEEK : RecencyFilter.NONE),
    messageStrategy: task.requiresReasoning || rank >= complexityRank(TaskComplexity.HIGH) ? MessageStrategy.SYSTEM_USER_ASSISTANT : MessageStrategy.SYSTEM_USER,
    temperature: task.type === TaskType.CONTENT_GENERATION ? 0.7 : 0.2,
    maxTokens,
    domainFilter: task.domainFilter ?? [],
    variations,
    reasoningEffort: model === SonarModel.SONAR_REASONING_PRO ? (task.complexity === TaskComplexity.CRITICAL ? 'high' : 'medium') : undefined,
    disableSearch: task.requiresSearch === false && !isSearchTask(task.type),
    estimatedCostPerCall,
    resolutionReason: `Task[${task.type}] complexity[${task.complexity}] uses ${model}`,
  };
}
