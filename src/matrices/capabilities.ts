import { TaskType, type ResolvedCapabilities, type TaskDescriptor } from '../types.js';
import { resolveSearchPolicy, UnsupportedCapabilityCombinationError } from './search-policy.js';

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

/**
 * Fail-closed error for a vision task that supplied no images.
 *
 * A visual task dispatched without images would run ordinary text completion
 * on the vision plane, silently pretending the visual analysis happened.
 * Refuse it before any reservation, circuit permit, or provider dispatch.
 */
export class VisionInputRequiredError extends Error {
  public readonly code = 'VISION_INPUT_REQUIRED';
  constructor(public readonly taskType: TaskType) {
    super(`Task[${taskType}] is a vision task but supplied no images; the vision plane cannot execute without visual input.`);
    this.name = 'VisionInputRequiredError';
  }
  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, taskType: this.taskType, message: this.message };
  }
}

/**
 * Fail unsupported capability combinations before routing.
 *
 * Until a governed multimodal-search provider contract exists, the router
 * refuses requests it cannot honour without silently dropping a capability:
 *
 * - visionRequired + searchRequired — no provider serves search and vision
 *   together; routing one capability would discard the other.
 * - images on a non-vision task type — images are only consumed by the vision
 *   branch, so they would be silently ignored anywhere else.
 * - a vision task with no images — the vision plane cannot execute without
 *   visual input.
 */
export function assertSupportedCapabilities(task: TaskDescriptor, capabilities: ResolvedCapabilities): void {
  const imageCount = task.images?.length ?? 0;
  if (capabilities.searchRequired && capabilities.visionRequired) {
    throw new UnsupportedCapabilityCombinationError(
      `Task[${task.type}] requires search and vision together, but no provider in this router serves both. Split the work into a vision task and a search task.`,
      { taskType: task.type, searchRequired: true, imageCount },
    );
  }
  if (imageCount > 0 && !capabilities.visionRequired) {
    throw new UnsupportedCapabilityCombinationError(
      `Task[${task.type}] supplied ${imageCount} image(s) but is not a vision task; images are only consumed by the vision branch.`,
      { taskType: task.type, searchRequired: capabilities.searchRequired, imageCount },
    );
  }
  if (capabilities.visionRequired && imageCount === 0) {
    throw new VisionInputRequiredError(task.type);
  }
}
