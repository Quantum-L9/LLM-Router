/**
 * @l9_meta
 * @module @quantum-l9/llm-router
 * @file src/index.ts
 * @purpose Main entry point — the unified LLM Router that all L9 bots consume
 * @pattern TaskDescriptor → Router → Provider Client → LLMResponse
 * @consumers l9-seo-bot, l9-website-factory, future bots
 */
import { TaskDescriptor, LLMResponse, BudgetConfig, RouterConfig, RoutingDecision } from './types.js';
import { type FullSiteQAConfig, type VisualQATask } from './vision/index.js';
export declare class L9LLMRouter {
    private budget;
    private perplexity;
    private openrouter;
    private callLog;
    constructor(config: RouterConfig);
    /**
     * Route a task to the optimal model and execute it.
     * This is the ONLY method consuming bots need to call.
     *
     * @example
     * const response = await router.execute({
     *   clientId: 'safehavenrr',
     *   type: TaskType.CONTENT_GENERATION,
     *   complexity: TaskComplexity.MEDIUM,
     *   description: 'Write a blog post about roof repair costs',
     * }, systemPrompt, userPrompt);
     */
    execute(task: TaskDescriptor, systemPrompt: string, userPrompt: string, options?: {
        images?: string[];
        assistantContext?: string;
        consensus?: boolean;
    }): Promise<LLMResponse>;
    /**
     * Determine routing without executing.
     * Useful for cost estimation and planning.
     */
    route(task: TaskDescriptor): RoutingDecision;
    initClient(clientId: string, budgetOverrides?: Partial<BudgetConfig>): void;
    resetDaily(clientId: string): void;
    resetWeekly(clientId: string): void;
    resetMonthly(clientId: string): void;
    getClientBudgetReport(clientId: string): import("./types.js").BudgetState;
    getAllBudgetReports(): import("./types.js").BudgetState[];
    getGlobalSpend(): {
        monthSpend: number;
        ceiling: number;
        utilization: number;
    };
    getCallLog(limit?: number): RoutingDecision[];
    getCallLogByClient(clientId: string, limit?: number): RoutingDecision[];
    /**
     * Generate a full-site visual QA plan.
     * The consuming bot takes the screenshots and calls execute() for each task.
     */
    planVisualQA(config: FullSiteQAConfig): VisualQATask[];
    getViewports(): Record<string, import("./index.js").ViewportConfig>;
    private getDowngradedModel;
}
export declare class BudgetExhaustedError extends Error {
    task: TaskDescriptor;
    decision: RoutingDecision;
    constructor(message: string, task: TaskDescriptor, decision: RoutingDecision);
}
export { TaskType, TaskComplexity, TaskDescriptor, LLMResponse, Provider, GeneralModel, SonarModel, BudgetConfig, RouterConfig, RoutingDecision, } from './types.js';
export { BudgetTracker, ThrottleLevel } from './budget/index.js';
export { resolvePerplexityConfig } from './matrices/perplexity-matrix.js';
export { resolveGeneralConfig, getFallbackChain } from './matrices/general-matrix.js';
export { resolveVisionConfig, VIEWPORTS, VISUAL_QA_PROMPTS } from './vision/index.js';
export type { FullSiteQAConfig, VisualQATask, ViewportConfig } from './vision/index.js';
//# sourceMappingURL=index.d.ts.map