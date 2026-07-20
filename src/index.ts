import { BudgetTracker } from './budget/index.js';
import { resolveGeneralConfig } from './matrices/general-matrix.js';
import { resolvePerplexityConfig } from './matrices/perplexity-matrix.js';
import { OpenRouterClient } from './providers/openrouter.js';
import { PerplexityClient } from './providers/perplexity.js';
import { Provider, TaskType, type LLMResponse, type RouterConfig, type RoutingDecision, type TaskDescriptor } from './types.js';
export class L9LLMRouter {
  private budget = new BudgetTracker(); private openrouter: OpenRouterClient; private perplexity: PerplexityClient;
  constructor(config: RouterConfig) { this.openrouter = new OpenRouterClient(config.openrouterApiKey, config.appName); this.perplexity = new PerplexityClient(config.perplexityApiKey); }
  initClient(id: string): void { this.budget.initClient(id); }
  route(task: TaskDescriptor): RoutingDecision { const search = [TaskType.COMPETITOR_RESEARCH, TaskType.CITATION_CHECK, TaskType.FACT_VERIFICATION, TaskType.MARKET_RESEARCH, TaskType.LINK_PROSPECTING].includes(task.type); const config = search ? resolvePerplexityConfig(task) : resolveGeneralConfig(task); return { taskId: crypto.randomUUID(), clientId: task.clientId ?? 'default', taskType: task.type, complexity: task.complexity, provider: config.provider, model: config.model, estimatedCost: config.estimatedCostPerCall, reason: config.resolutionReason, timestamp: new Date().toISOString() }; }
  async execute(task: TaskDescriptor, system: string, user: string): Promise<LLMResponse> { const decision = this.route(task); if (decision.provider === Provider.PERPLEXITY) return this.perplexity.complete(resolvePerplexityConfig(task), system, user); return this.openrouter.complete(resolveGeneralConfig(task), system, user); }
}
export * from './types.js';
