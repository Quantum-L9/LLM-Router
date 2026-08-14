import { TaskType, type TaskDescriptor } from '../types.js';

/**
 * Task types whose *default* capability implies a search-backed provider.
 *
 * This is the legacy behaviour: choosing one of these task types historically
 * routed the call through the search matrix regardless of the caller's intent.
 * It remains the fallback when a caller does not declare `requiresSearch`.
 */
const DEFAULT_SEARCH_TASKS = new Set<TaskType>([
  TaskType.COMPETITOR_RESEARCH,
  TaskType.CITATION_CHECK,
  TaskType.FACT_VERIFICATION,
  TaskType.MARKET_RESEARCH,
  TaskType.LINK_PROSPECTING,
]);

/**
 * Backward-compatible task-type default.
 *
 * Preserved verbatim so existing consumers that reason purely about a
 * `TaskType` keep the same answer. New routing decisions should prefer
 * {@link requiresSearchProvider}, which honours an explicit capability flag.
 */
export function isSearchTask(type: TaskType): boolean {
  return DEFAULT_SEARCH_TASKS.has(type);
}

/**
 * Explicit capability declaration wins.
 *
 * Applications declare *whether the task needs a search provider* via
 * `TaskDescriptor.requiresSearch`. When present, that declaration is
 * authoritative and overrides the legacy per-`TaskType` default.
 *
 * This fixes the architecture leak where selecting a research-flavoured
 * `TaskType` (e.g. MARKET_RESEARCH) implied a specific provider even when the
 * caller already had normalized evidence and explicitly did not require search.
 *
 * Semantics:
 *   requiresSearch === true   -> search provider
 *   requiresSearch === false  -> general reasoning provider
 *   requiresSearch === undefined -> legacy TaskType default (isSearchTask)
 */
export function requiresSearchProvider(task: TaskDescriptor): boolean {
  if (typeof task.requiresSearch === 'boolean') {
    return task.requiresSearch;
  }
  return isSearchTask(task.type);
}
