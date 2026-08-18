import { SearchPolicySource, TaskType, type SearchPolicyResolution, type TaskDescriptor } from '../types.js';

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
 * {@link resolveSearchPolicy}, which honours an explicit capability flag and
 * reports *why* the answer was reached.
 */
export function isSearchTask(type: TaskType): boolean {
  return DEFAULT_SEARCH_TASKS.has(type);
}

/**
 * Canonical search-policy resolver — the single implementation of the rule.
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
 *   requiresSearch === true       -> search provider   (source EXPLICIT)
 *   requiresSearch === false      -> general provider  (source EXPLICIT)
 *   requiresSearch === undefined  -> isSearchTask(type) (source TASK_DEFAULT)
 *
 * The returned `source` is what makes an audited routing decision provable:
 * it distinguishes "the caller asked for this" from "the task type implied it".
 */
export function resolveSearchPolicy(task: TaskDescriptor): SearchPolicyResolution {
  if (typeof task.requiresSearch === 'boolean') {
    return { required: task.requiresSearch, source: SearchPolicySource.EXPLICIT };
  }
  return { required: isSearchTask(task.type), source: SearchPolicySource.TASK_DEFAULT };
}

/**
 * Boolean view of {@link resolveSearchPolicy}. Retained as the 1.x public
 * predicate; it delegates so there is exactly one implementation of the rule.
 */
export function requiresSearchProvider(task: TaskDescriptor): boolean {
  return resolveSearchPolicy(task).required;
}

/**
 * Fail-closed error for a task that asks for two capabilities the router has no
 * provider contract able to satisfy together.
 *
 * Raised today for `vision task type + images + requiresSearch === true`: the
 * search plane (Perplexity Sonar) has no multimodal transport in this router,
 * so honouring one capability necessarily discards the other. Dropping either
 * silently would make the routing audit a lie, so the request is rejected
 * before any reservation, circuit permit, or provider dispatch.
 *
 * This is a caller-side contract error, not a provider failure: it must never
 * count against provider circuit health.
 */
export class UnsupportedCapabilityCombinationError extends Error {
  public readonly code = 'UNSUPPORTED_CAPABILITY_COMBINATION';
  constructor(
    message: string,
    public readonly requested: Readonly<{ taskType: TaskType; searchRequired: boolean; imageCount: number }>,
  ) {
    super(message);
    this.name = 'UnsupportedCapabilityCombinationError';
  }
  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, message: this.message, requested: this.requested };
  }
}
