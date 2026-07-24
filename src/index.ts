import { randomUUID } from 'node:crypto';
import { BudgetReservationError, BudgetTracker } from './budget/index.js';
import { CircuitBreaker, CircuitOpenError, type CircuitPermit } from './circuit-breaker.js';
import { resolveGeneralConfig, getFallbackChain } from './matrices/general-matrix.js';
import { isSearchTask, resolvePerplexityConfig } from './matrices/perplexity-matrix.js';
import { classifyProviderError, isCircuitFailure } from './provider-errors.js';
import { OpenRouterClient, validateImageUrl, type OpenRouterClientLike } from './providers/openrouter.js';
import { PerplexityClient, type PerplexityClientLike } from './providers/perplexity.js';
import { parseExecutableTaskDescriptor, parseRouterConfig, parseTaskDescriptor } from './schemas.js';
import {
  GeneralModel,
  Provider,
  SonarModel,
  TaskType,
  type BudgetConfig,
  type LLMResponse,
  type RouterConfig,
  type RoutingDecision,
  type RoutingResolution,
  type TaskDescriptor,
} from './types.js';
import { generateFullSiteQAPlan, resolveVisionConfig, VIEWPORTS, type FullSiteQAConfig, type VisualQATask } from './vision/index.js';

const VISION_TASKS = new Set<TaskType>([TaskType.VISUAL_QA, TaskType.SCREENSHOT_ANALYSIS, TaskType.LAYOUT_VALIDATION]);

export interface RouterDependencies {
  clock?: () => Date;
  idFactory?: () => string;
  openrouterClient?: OpenRouterClientLike;
  perplexityClient?: PerplexityClientLike;
}

export function resolveRoute(task: TaskDescriptor): RoutingResolution {
  if (isSearchTask(task.type)) {
    const config = resolvePerplexityConfig(task);
    return { taskType: task.type, complexity: task.complexity, provider: Provider.PERPLEXITY, model: config.model, estimatedCost: config.estimatedCostPerCall, reason: config.resolutionReason };
  }
  if (VISION_TASKS.has(task.type)) {
    const config = resolveVisionConfig(task.type as TaskType.VISUAL_QA | TaskType.SCREENSHOT_ANALYSIS | TaskType.LAYOUT_VALIDATION, task.complexity, task.images?.length ?? 1);
    return { taskType: task.type, complexity: task.complexity, provider: Provider.OPENROUTER, model: config.model, estimatedCost: config.estimatedCostPerCall, reason: config.resolutionReason };
  }
  const config = resolveGeneralConfig(task);
  return { taskType: task.type, complexity: task.complexity, provider: Provider.OPENROUTER, model: config.model, estimatedCost: config.estimatedCostPerCall, reason: config.resolutionReason };
}

export function getDowngradedModel(
  original: GeneralModel | SonarModel,
  provider: Provider,
  maxTier: 'fast' | 'strategic' | 'critical',
): GeneralModel | SonarModel {
  if (maxTier === 'critical') return original;
  if (provider === Provider.PERPLEXITY) return maxTier === 'fast' ? SonarModel.SONAR : original === SonarModel.SONAR_DEEP_RESEARCH ? SonarModel.SONAR_REASONING_PRO : original;
  if (maxTier === 'fast') return GeneralModel.GPT4O_MINI;
  return [GeneralModel.CLAUDE_OPUS, GeneralModel.O1, GeneralModel.O3].includes(original as GeneralModel) ? GeneralModel.CLAUDE_SONNET : original;
}

export class L9LLMRouter {
  private readonly budget: BudgetTracker;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly perplexity: PerplexityClientLike;
  private readonly openrouter: OpenRouterClientLike;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly callLog: RoutingDecision[] = [];

  constructor(config: RouterConfig, dependencies: RouterDependencies = {}) {
    const validated = parseRouterConfig(config);
    this.budget = new BudgetTracker(validated.budget);
    this.circuitBreaker = new CircuitBreaker(validated.circuitBreaker);
    this.clock = dependencies.clock ?? (() => new Date());
    this.idFactory = dependencies.idFactory ?? randomUUID;
    this.perplexity = dependencies.perplexityClient ?? new PerplexityClient(validated.perplexityApiKey, validated.providerTimeoutMs);
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
    const task = options?.images === undefined
      ? parsedTask
      : parseExecutableTaskDescriptor({ ...parsedTask, images: options.images });
    const images = task.images;
    if (images) for (const image of images) validateImageUrl(image);
    const decision = this.route(task);

    let reservationId: string | undefined;
    let permit: CircuitPermit | undefined;
    try {
      const { decision: throttle, reservation } = this.budget.reserveTask(task.clientId, task, decision.estimatedCost, this.clock(), this.idFactory);
      reservationId = reservation.id;
      if (throttle.forceDowngrade) {
        decision.downgraded = true;
        decision.downgradedFrom = decision.model;
        decision.model = getDowngradedModel(decision.model, decision.provider, throttle.maxModelTier);
      }

      permit = this.circuitBreaker.acquire(decision.provider, this.clock());
      let response: LLMResponse;
      if (decision.provider === Provider.PERPLEXITY) {
        const config = resolvePerplexityConfig(task);
        if (!Object.values(SonarModel).includes(decision.model as SonarModel)) throw new Error('Perplexity route resolved a non-Sonar model');
        config.model = decision.model as SonarModel;
        if (options?.consensus && config.variations > 1) {
          const consensus = await this.perplexity.completeWithConsensus(config, systemPrompt, userPrompt, options.assistantContext, options.signal);
          response = {
            ...consensus.best,
            inputTokens: consensus.aggregate.inputTokens,
            outputTokens: consensus.aggregate.outputTokens,
            totalTokens: consensus.aggregate.totalTokens,
            cost: consensus.aggregate.cost,
            latencyMs: consensus.aggregate.latencyMs,
            citations: consensus.aggregate.citations,
          };
        } else {
          response = await this.perplexity.complete(config, systemPrompt, userPrompt, options?.assistantContext, options?.signal);
        }
      } else if (VISION_TASKS.has(task.type) && images?.length) {
        const config = resolveVisionConfig(task.type as TaskType.VISUAL_QA | TaskType.SCREENSHOT_ANALYSIS | TaskType.LAYOUT_VALIDATION, task.complexity, images.length);
        config.model = decision.model as GeneralModel;
        response = await this.openrouter.completeWithVision(config, systemPrompt, userPrompt, images, options?.signal);
      } else {
        const config = resolveGeneralConfig(task);
        config.model = decision.model as GeneralModel;
        response = await this.openrouter.completeWithFallback(config, getFallbackChain(config.model), systemPrompt, userPrompt, options?.signal);
      }

      this.circuitBreaker.recordSuccess(permit);
      this.budget.reconcile(reservationId, response.cost);
      reservationId = undefined;
      decision.actualCost = response.cost;
      decision.latencyMs = response.latencyMs;
      this.callLog.push(decision);
      return response;
    } catch (error) {
      if (reservationId) this.budget.release(reservationId);
      if (permit) {
        if (isCircuitFailure(error, decision.provider)) this.circuitBreaker.recordFailure(permit, this.clock());
        else this.circuitBreaker.release(permit, this.clock());
      }
      if (error instanceof BudgetReservationError) throw new BudgetExhaustedError(error.message, task, decision, error);
      if (error instanceof CircuitOpenError) throw error;
      if (error instanceof Error && ['TaskValidationError', 'UnsafeImageUrlError'].includes(error.name)) throw error;
      throw classifyProviderError(error, decision.provider);
    }
  }

  initClient(clientId: string, overrides?: Partial<BudgetConfig>): void { this.budget.initClient(clientId, overrides); }
  resetDaily(clientId: string): void { this.budget.resetDaily(clientId); }
  resetWeekly(clientId: string): void { this.budget.resetWeekly(clientId); }
  resetMonthly(clientId: string): void { this.budget.resetMonthly(clientId); }
  resetGlobalMonthly(): void { this.budget.resetGlobalMonthly(); }
  checkSurge(clientId: string, dayOfWeek: number = this.clock().getDay()): boolean { return this.budget.checkSurgeAllowance(clientId, dayOfWeek); }
  getClientBudgetReport(clientId: string) { return this.budget.getClientBudgetReport(clientId); }
  getAllBudgetReports() { return this.budget.getAllBudgetReports(); }
  getGlobalSpend() { return this.budget.getGlobalSpend(); }
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
export { BudgetTracker, BudgetReservationError, ThrottleLevel } from './budget/index.js';
export { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
export { ProviderRequestError } from './provider-errors.js';
export { TaskValidationError, RouterConfigValidationError } from './schemas.js';
export { UnsafeImageUrlError, InvalidBaseUrlError, DEFAULT_OPENROUTER_BASE_URL, resolveOpenRouterBaseUrl } from './providers/openrouter.js';
export { VIEWPORTS } from './vision/index.js';
