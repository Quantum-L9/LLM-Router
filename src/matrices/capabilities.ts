import { TaskType, type ResolvedCapabilities, type TaskDescriptor } from '../types.js';
import { resolveSearchPolicy } from './search-policy.js';

/**
 * Task types whose images are consumed by the OpenRouter vision branch.
 *
 * This is the single authority for `visionRequired`; it was previously a
 * private constant inside the router class file and is now exported so the
 * canonical capability resolver and the dispatch code share one definition.
 */
export const VISION_TASKS = new Set<TaskType>([
  TaskType.VISUAL_QA,
  TaskType.SCREENSHOT_ANALYSIS,
  TaskType.LAYOUT_VALIDATION,
]);

/**
 * Canonical capability resolver — one source of truth for what a task needs.
 *
 * `searchRequired` and `searchPolicySource` delegate to the search-policy
 * resolver (`resolveSearchPolicy`), so there is exactly one implementation of
 * the search rule. `visionRequired` is true exactly for the vision task types.
 *
 * Routing, failure semantics, and the audit trail all consume this shape so a
 * decision reports the same capabilities everywhere without re-deriving them.
 */
export function resolveCapabilities(task: TaskDescriptor): ResolvedCapabilities {
  const policy = resolveSearchPolicy(task);
  return {
    searchRequired: policy.required,
    searchPolicySource: policy.source,
    visionRequired: VISION_TASKS.has(task.type),
  };
}
