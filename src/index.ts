import { randomUUID } from 'node:crypto';
import type { RouterMemoryConfig } from './memory.js';
import { hydrateRouterPrompt } from './memory.js';
import {
  BudgetReservationError,
  BudgetTracker,
  InMemoryBudgetStore,
  type BudgetStore,
} from './budget/index.js';
import { CircuitBreaker, CircuitOpenError, type CircuitPermit } from './circuit-breaker.js';
import { resolveGeneralConfig, getFallbackChain } from './matrices/general-matrix.js';
import { resolvePerplexityConfig } from './matrices/perplexity-matrix.js';
import { assertSupportedCapabilities, resolveCapabilities, VISION_TASKS } from './matrices/capabilities.js';
import { classifyProviderError, isCircuitFailure } from './provider-errors.js';
import { OpenRouterClient, validateImageUrl, type OpenRouterClientLike } from './providers/openrouter.js';
import { PerplexityClient, type PerplexityClientLike } from './providers/perplexity.js';
import { parseExecutableTaskDescriptor, parseRouterConfig, parseTaskDescriptor } from './schemas.js';
import {
  GeneralModel,
  Provider,
  SonarModel,
  type BudgetConfig,
  type LLMResponse,
  type RouterConfig,
  type RoutingDecision,
  type RoutingResolution,
  type TaskDescriptor,
  type TaskType,
} from './types.js';
import { generateFullSiteQAPlan, resolveVisionConfig, VIEWPORTS, type FullSiteQAConfig, type VisualQATask } from './vision/index.js';

export interface RouterDependencies {
  clock?: () => Date;
  idFactory?: () => string;
  openrouterClient?: OpenRouterClientLike;
  perplexityClient?: PerplexityClientLike;
  budgetStore?: BudgetStore;
  memory?: RouterMemoryConfig;
}

export function resolveRoute(task: TaskDescriptor): RoutingResolution {
  const capabilities = resolveCapabilities(task);
  const { searchRequired, searchPolicySource, visionRequired } = capabilities;
  const audit = { taskType: task.type, complexity: task.complexity, searchRequired, searchPolicySource };

  // Fail closed before any capability can be silently discarded: search+vision
  // together, images on a non-vision task, or a vision task without images are
  // caller-side contract errors refused before any reservation or dispatch.
  assertSupportedCapabilities(task, capabilities);

  if (searchRequired) {
    const config = resolvePerplexityConfig(task);
    return { ...audit, provider: Provider.PERPLEXITY, model: config.model, estimatedCost: config.estimatedCostPerCall, reason: config.resolutionReason };
  }
  if (visionRequired) {
    const config = resolveVisionConfig(task.type as TaskType.VISUAL_QA | TaskType.SCREENSHOT_ANALYSIS | TaskType.LAYOUT_VALIDATION, task.complexity, task.images?.length ?? 1);
    return { ...audit, provider: Provider.OPENROUTER, model: config.model, estimatedCost: config.estimatedCostPerCall, reason: config.resolutionReason };
  }
  const config = resolveGeneralConfig(task);
  return { ...audit, provider: Provider.OPENROUTER, model: config.model, estimatedCost: config.estimatedCostPerCall, reason: config.resolutionReason };
}

export function getDowngradedModel(
  original: GeneralModel | SonarModel,
  provider: Provider,
  maxTier: 'fast' | 'strategic' | 'critical',
): GeneralModel | SonarModel {
  if (maxTier === 'critical') return original;
  if (provider === Provider.PERPLEXITY) {
    if (maxTier === 'fast') return SonarModel.SONAR;
    return original === SonarModel.SONAR_DEEP_RESEARCH ? SonarModel.SONAR_REASONING_PRO : original;
  }
  if (maxTier === 'fast') return GeneralModel.GPT4O_MINI;
  return [GeneralModel.CLAUDE_OPUS, GeneralModel.O1, GeneralModel.O3].includes(original as GeneralModel) ? GeneralModel.CLAUDE_SONNET : original;
}

export class L9LLMRouter {
  private readonly budgetStore: BudgetStore;
  private readonly localBudgetTracker?: BudgetTracker;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly perplexity: PerplexityClientLike;
  private readonly openrouter: OpenRouterClientLike;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly callLog: RoutingDecision[] = [];
  private readonly memory?: RouterMemoryConfig;

  constructor(config: RouterConfig, dependencies: RouterDependencies = {}) {
    const validated = parseRouterConfig(config);
    if (dependencies.budgetStore) {
      this.budgetStore = dependencies.budgetStore;
    } else {
      this.localBudgetTracker = new BudgetTracker(validated.budget);
      this.budgetStore = new InMemoryBudgetStore(this.localBudgetTracker);
    }
    this.circuitBreaker = new CircuitBreaker(validated.circuitBreaker);
    this.clock = dependencies.clock ?? (() => new Date());
    this.idFactory = dependencies.idFactory ?? randomUUID;
    this.perplexity = dependencies.perplexityClient ?? new PerplexityClient(validated.perplexityApiKey, validated.providerTimeoutMs);
    this.memory = dependencies.memory;
    this.openrouter = dependencies.openrouterClient ?? new OpenRouterClient(validated.openrouterApiKey, validated.appName, validated.providerTimeoutMs, undefined, validated.openrouterBaseUrl);
  }

  route(input: TaskDescriptor): RoutingDecision {
    const task = parseTaskDescriptor(input);
    const resolution = resolveRoute(task);
    return { ...resolution, taskId: this.idFactory(), clientId: task.clientId ?? 'default', timestamp: this.clock().toISOString() };
  }

  async execute(
    input: TaskDescriptor,
    systemPrompt: string,
    userPrompt: string,
    options?: { images?: string[]; assistantContext?: string; consensus?: boolean; signal?: AbortSignal },
  ): Promise<LLMResponse> {
    const parsedTask = parseExecutableTaskDescriptor(input);
    const task = options?.images === undefined ? parsedTask : parseExecutableTaskDescriptor({ ...parsedTask, images: options.images });
    const images = task.images;
    if (images) for (const image of images) validateImageUrl(image);
    const decision = this.route(task);
    const governedMemory = await hydrateRouterPrompt(this.memory, decision.clientId, task.type, userPrompt);
    const effectiveSystemPrompt = governedMemory ? `${systemPrompt}${governedMemory}` : systemPrompt;

    let reservationId: string | undefined;
    let permit: CircuitPermit | undefined;
    let providerCompleted = false;
    try {
      const { decision: throttle, reservation } = await this.budgetStore.reserveTask(task.clientId, task, decision.estimatedCost, this.clock(), this.idFactory);
      reservationId = reservation.id;
      if (throttle.forceDowngrade) {
        decision.downgraded = true;
        decision.downgradedFrom = decision.model;
        decision.model = getDowngradedModel(decision.model, decision.provider, throttle.maxModelTier);
      }

      permit = this.circuitBreaker.acquire(decision.provider, this.clock());
      const response = await this.dispatchProvider(task, decision, effectiveSystemPrompt, userPrompt, images, options);

      providerCompleted = true;
      this.circuitBreaker.recordSuccess(permit);
      await this.budgetStore.reconcile(reservationId, response.cost);
      reservationId = undefined;
      decision.actualCost = response.cost;
      decision.latencyMs = response.latencyMs;
      this.callLog.push(decision);
      return response;
    } catch (error) {
      // Before provider completion, release an unbilled reservation. After a
      // provider response, retain it if reconciliation fails so durable budget
      // state remains fail-closed and can be repaired instead of forgetting cost.
      if (reservationId && !providerCompleted) await this.budgetStore.release(reservationId);
      if (permit) {
        if (isCircuitFailure(error, decision.provider)) this.circuitBreaker.recordFailure(permit, this.clock());
        else this.circuitBreaker.release(permit, this.clock());
      }
      if (providerCompleted) throw error;
      throw this.toExecutionError(error, task, decision);
    }
  }

  private dispatchProvider(
    task: TaskDescriptor,
    decision: RoutingDecision,
    effectiveSystemPrompt: string,
    userPrompt: string,
    images: string[] | undefined,
    options: { images?: string[]; assistantContext?: string; consensus?: boolean; signal?: AbortSignal } | undefined,
  ): Promise<LLMResponse> {
    // The audited decision and the plane about to be dispatched must agree in
    // both directions: a search decision may not execute on the general plane,
    // and a non-search decision may not execute web search. Perplexity is the
    // router's only search-capable provider.
    if (decision.searchRequired !== (decision.provider === Provider.PERPLEXITY)) {
      throw new Error(`Routing decision searchRequired=${decision.searchRequired} disagrees with provider ${decision.provider}`);
    }
    // A vision task must dispatch on the OpenRouter vision plane; Perplexity
    // has no multimodal transport, and a vision task must never fall through
    // to the general text path.
    if (VISION_TASKS.has(task.type) && decision.provider !== Provider.OPENROUTER) {
      throw new Error(`Vision task ${task.type} disagrees with provider ${decision.provider}`);
    }
    if (decision.provider === Provider.PERPLEXITY) {
      const config = resolvePerplexityConfig(task);
      if (!Object.values(SonarModel).includes(decision.model as SonarModel)) throw new Error('Perplexity route resolved a non-Sonar model');
      // A search route may never dispatch a config that turns search off.
      if (config.disableSearch) throw new Error('Search route resolved a Perplexity config with search disabled');
      config.model = decision.model as SonarModel;
      if (options?.consensus && config.variations > 1) {
        return this.perplexity.completeWithConsensus(config, effectiveSystemPrompt, userPrompt, options.assistantContext, options.signal).then(consensus => ({
          ...consensus.best,
          inputTokens: consensus.aggregate.inputTokens,
          outputTokens: consensus.aggregate.outputTokens,
          totalTokens: consensus.aggregate.totalTokens,
          cost: consensus.aggregate.cost,
          latencyMs: consensus.aggregate.latencyMs,
          citations: consensus.aggregate.citations,
        }));
      }
      return this.perplexity.complete(config, effectiveSystemPrompt, userPrompt, options?.assistantContext, options?.signal);
    }
    if (VISION_TASKS.has(task.type) && images?.length) {
      const config = resolveVisionConfig(task.type as TaskType.VISUAL_QA | TaskType.SCREENSHOT_ANALYSIS | TaskType.LAYOUT_VALIDATION, task.complexity, images.length);
      config.model = decision.model as GeneralModel;
      return this.openrouter.completeWithVision(config, effectiveSystemPrompt, userPrompt, images, options?.signal);
    }
    const config = resolveGeneralConfig(task);
    config.model = decision.model as GeneralModel;
    return this.openrouter.completeWithFallback(config, getFallbackChain(config.model), effectiveSystemPrompt, userPrompt, options?.signal);
  }

  private toExecutionError(error: unknown, task: TaskDescriptor, decision: RoutingDecision): Error {
    if (error instanceof BudgetReservationError) return new BudgetExhaustedError(error.message, task, decision, error);
    if (error instanceof CircuitOpenError) return error;
    if (error instanceof Error && ['TaskValidationError', 'UnsafeImageUrlError'].includes(error.name)) return error;
    return classifyProviderError(error, decision.provider);
  }

  initClient(clientId: string, overrides?: Partial<BudgetConfig>): Promise<void> { return this.budgetStore.initClient(clientId, overrides); }
  resetDaily(clientId: string): Promise<void> { return this.budgetStore.resetDaily(clientId); }
  resetWeekly(clientId: string): Promise<void> { return this.budgetStore.resetWeekly(clientId); }
  resetMonthly(clientId: string): Promise<void> { return this.budgetStore.resetMonthly(clientId); }
  resetGlobalMonthly(): Promise<void> { return this.budgetStore.resetGlobalMonthly(); }
  checkSurge(clientId: string, dayOfWeek: number = this.clock().getDay()): Promise<boolean> { return this.budgetStore.checkSurgeAllowance(clientId, dayOfWeek); }

  getClientBudgetReport(clientId: string) {
    if (!this.localBudgetTracker) throw new Error('Synchronous budget reports are unavailable with an external BudgetStore; use getClientBudgetReportAsync()');
    return this.localBudgetTracker.getClientBudgetReport(clientId);
  }
  getAllBudgetReports() {
    if (!this.localBudgetTracker) throw new Error('Synchronous budget reports are unavailable with an external BudgetStore; use getAllBudgetReportsAsync()');
    return this.localBudgetTracker.getAllBudgetReports();
  }
  getGlobalSpend() {
    if (!this.localBudgetTracker) throw new Error('Synchronous budget reports are unavailable with an external BudgetStore; use getGlobalSpendAsync()');
    return this.localBudgetTracker.getGlobalSpend();
  }
  getClientBudgetReportAsync(clientId: string) { return this.budgetStore.getClientBudgetReport(clientId); }
  getAllBudgetReportsAsync() { return this.budgetStore.getAllBudgetReports(); }
  getGlobalSpendAsync() { return this.budgetStore.getGlobalSpend(); }
  getCircuitState(provider: Provider) { return this.circuitBreaker.getState(provider); }
  getCallLog(limit = 100): RoutingDecision[] { return this.callLog.slice(-limit).map(entry => ({ ...entry })); }
  getCallLogByClient(clientId: string, limit = 50): RoutingDecision[] { return this.callLog.filter(entry => entry.clientId === clientId).slice(-limit).map(entry => ({ ...entry })); }
  planVisualQA(config: FullSiteQAConfig): VisualQATask[] { return generateFullSiteQAPlan(config); }
  getViewports() { return VIEWPORTS; }
}

export class BudgetExhaustedError extends Error {
  public override readonly cause: BudgetReservationError;
  constructor(message: string, public readonly task: TaskDescriptor, public readonly decision: RoutingDecision, cause: BudgetReservationError) {
    super(message, { cause });
    this.name = 'BudgetExhaustedError';
    this.cause = cause;
  }
}

export * from './types.js';
export {
  DEFAULT_BUDGET_CONFIG,
  BudgetTracker,
  BudgetReservationError,
  InMemoryBudgetStore,
  ThrottleLevel,
  evaluateBudgetAdmission,
  validateBudgetConfig,
} from './budget/index.js';
export type { BudgetStore, GlobalBudgetState, ThrottleDecision, BudgetAdmissionInput } from './budget/index.js';
export { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
export { ProviderRequestError } from './provider-errors.js';
export { TaskValidationError, RouterConfigValidationError } from './schemas.js';
export { UnsafeImageUrlError, InvalidBaseUrlError, DEFAULT_OPENROUTER_BASE_URL, resolveOpenRouterBaseUrl } from './providers/openrouter.js';
export { VIEWPORTS } from './vision/index.js';
export {
  isSearchTask,
  requiresSearchProvider,
  resolveSearchPolicy,
  UnsupportedCapabilityCombinationError,
} from './matrices/search-policy.js';

export { hydrateRouterPrompt } from './memory.js';
export type { RouterMemoryConfig } from './memory.js';
