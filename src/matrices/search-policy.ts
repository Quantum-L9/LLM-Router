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
 * Task types whose *default* capability implies a vision-backed provider.
 *
 * This is the canonical vision-task inventory for the whole router: routing
 * and dispatch both consume it through {@link resolveCapabilities}, so no
 * other module may re-derive vision from a raw `TaskType`.
 */
export const VISION_TASKS = new Set<TaskType>([
  TaskType.VISUAL_QA,
  TaskType.SCREENSHOT_ANALYSIS,
  TaskType.LAYOUT_VALIDATION,
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
 * The single internal capability authority.
 *
 * Routing and dispatch both consume this resolution, so a request can never
 * be interpreted one way at routing time and another way at dispatch time.
 */
export interface ResolvedCapabilities {
  /** Whether the resolved route must carry web-search capability (explicit flag or task-type default). */
  searchRequired: boolean;
  /** Where `searchRequired` came from: an explicit `TaskDescriptor.requiresSearch` boolean, or the legacy per-TaskType default. */
  searchPolicySource: SearchPolicySource;
  /** Whether the task type implies a vision-backed provider. */
  visionRequired: boolean;
  /** Whether the descriptor actually carries at least one image. */
  imagesProvided: boolean;
}

export function resolveCapabilities(task: TaskDescriptor): ResolvedCapabilities {
  const policy = resolveSearchPolicy(task);
  return {
    searchRequired: policy.required,
    searchPolicySource: policy.source,
    visionRequired: VISION_TASKS.has(task.type),
    imagesProvided: Array.isArray(task.images) && task.images.length > 0,
  };
}

/**
 * Capability conflicts the current provider plane cannot execute faithfully.
 *
 * Every code names a combination that would otherwise degrade silently:
 *
 *   UNSUPPORTED_CAPABILITY_COMBINATION — search + vision together (legacy code)
 *   VISION_INPUT_REQUIRED               — vision task without images
 *   IMAGES_NOT_SUPPORTED_FOR_TASK       — images on a non-vision task
 *   SEARCH_MODIFIER_WITHOUT_SEARCH      — recency/domainFilter without search
 *   CONSENSUS_REQUIRES_SEARCH           — consensus on a non-search route
 */
export type CapabilityConflictCode =
  | 'UNSUPPORTED_CAPABILITY_COMBINATION'
  | 'VISION_INPUT_REQUIRED'
  | 'IMAGES_NOT_SUPPORTED_FOR_TASK'
  | 'SEARCH_MODIFIER_WITHOUT_SEARCH'
  | 'CONSENSUS_REQUIRES_SEARCH';

/**
 * Fail-closed error for a task that asks for capabilities the router has no
 * provider contract able to satisfy faithfully.
 *
 * Raised before any budget reservation, circuit permit, or provider dispatch,
 * so an invalid request can never half-execute. This is a caller-side contract
 * error, not a provider failure: it must never count against provider circuit
 * health.
 *
 * The original `(message, requested)` constructor shape from #46 is preserved;
 * newer capability codes pass only `code` and omit `requested`.
 */
export class UnsupportedCapabilityCombinationError extends Error {
  public readonly code: CapabilityConflictCode;
  constructor(
    message: string,
    public readonly requested?: Readonly<{ taskType: TaskType; searchRequired: boolean; imageCount: number }>,
    code: CapabilityConflictCode = 'UNSUPPORTED_CAPABILITY_COMBINATION',
  ) {
    super(message);
    this.name = 'UnsupportedCapabilityCombinationError';
    this.code = code;
  }
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.requested === undefined ? {} : { requested: this.requested }),
    };
  }
}

/**
 * Refuses capability combinations the execution plane would silently drop.
 *
 *   vision without images  -> VISION_INPUT_REQUIRED
 *   search + vision        -> UNSUPPORTED_CAPABILITY_COMBINATION (legacy shape)
 *   images on non-vision   -> IMAGES_NOT_SUPPORTED_FOR_TASK
 *
 * Called inside route resolution before any provider/model selection, so an
 * invalid request can never reserve budget or reach dispatch.
 */
export function validateCapabilities(capabilities: ResolvedCapabilities, task: TaskDescriptor): void {
  if (capabilities.visionRequired && !capabilities.imagesProvided) {
    throw new UnsupportedCapabilityCombinationError('Visual task requires at least one image', undefined, 'VISION_INPUT_REQUIRED');
  }
  if (capabilities.searchRequired && capabilities.visionRequired) {
    const imageCount = task.images?.length ?? 0;
    throw new UnsupportedCapabilityCombinationError(
      `Task[${task.type}] supplied ${imageCount} image(s) and requires search, but no provider in this router serves search and vision together. Split the work into a vision task and a search task.`,
      { taskType: task.type, searchRequired: true, imageCount },
    );
  }
  if (capabilities.imagesProvided && !capabilities.visionRequired) {
    throw new UnsupportedCapabilityCombinationError(`Task ${task.type} does not consume images`, undefined, 'IMAGES_NOT_SUPPORTED_FOR_TASK');
  }
}

/**
 * Resolves capabilities and refuses every combination the provider plane
 * cannot honor, including search-only modifiers on a non-search route.
 *
 * `recency` and `domainFilter` are search execution modifiers: a general
 * route ignores them, so declaring them without search capability is an
 * explicit contract error instead of silently ignored policy.
 */
export function resolveAndValidateCapabilities(task: TaskDescriptor): ResolvedCapabilities {
  const capabilities = resolveCapabilities(task);
  validateCapabilities(capabilities, task);
  const hasSearchModifiers = task.recency !== undefined || (task.domainFilter?.length ?? 0) > 0;
  if (!capabilities.searchRequired && hasSearchModifiers) {
    throw new UnsupportedCapabilityCombinationError('Search modifiers require search capability', undefined, 'SEARCH_MODIFIER_WITHOUT_SEARCH');
  }
  return capabilities;
}
