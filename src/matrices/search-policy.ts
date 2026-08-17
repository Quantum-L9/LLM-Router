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

/**
 * Fail-closed guard for capability combinations no current provider supports.
 *
 * The Perplexity client is text-only, so a search-required route cannot consume
 * images. Rather than silently dropping either requested capability (dropping
 * the images, or routing vision while pretending search happened), resolution
 * refuses the combination until a multimodal-search provider contract exists.
 */
export class UnsupportedCapabilityCombinationError extends Error {
  public readonly code = 'SEARCH_VISION_COMBINATION_UNSUPPORTED' as const;
  constructor(public readonly taskType: TaskType, public readonly capabilities: readonly string[]) {
    super(`Task type "${taskType}" requires an unsupported capability combination: ${capabilities.join(' + ')}`);
    this.name = 'UnsupportedCapabilityCombinationError';
  }
  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, taskType: this.taskType, capabilities: this.capabilities, message: this.message };
  }
}

/**
 * Throws {@link UnsupportedCapabilityCombinationError} when a search-required
 * route would also have to consume images. No silent capability loss: neither
 * the images nor the search request is dropped behind the caller's back.
 */
export function assertSearchVisionCompatible(task: TaskDescriptor, searchRequired: boolean): void {
  if (searchRequired && (task.images?.length ?? 0) > 0) {
    throw new UnsupportedCapabilityCombinationError(task.type, ['search', 'vision']);
  }
}
