/**
 * @l9_meta
 * @module @quantum-l9/llm-router
 * @file src/index.ts
 * @purpose Main entry point — the unified LLM Router that all L9 bots consume
 * @pattern TaskDescriptor → Router → Provider Client → LLMResponse
 * @consumers l9-seo-bot, l9-website-factory, future bots
 */
import { TaskType, Provider, GeneralModel, } from './types.js';
import { resolvePerplexityConfig } from './matrices/perplexity-matrix.js';
import { resolveGeneralConfig, getFallbackChain } from './matrices/general-matrix.js';
import { BudgetTracker } from './budget/index.js';
import { PerplexityClient } from './providers/perplexity.js';
import { OpenRouterClient } from './providers/openrouter.js';
import { resolveVisionConfig, generateFullSiteQAPlan, VIEWPORTS, } from './vision/index.js';
// ═══════════════════════════════════════════════════════════════
// SEARCH TASK TYPES (routed to Perplexity)
// ═══════════════════════════════════════════════════════════════
const SEARCH_TASK_TYPES = new Set([
    TaskType.COMPETITOR_RESEARCH,
    TaskType.CITATION_CHECK,
    TaskType.FACT_VERIFICATION,
    TaskType.MARKET_RESEARCH,
    TaskType.LINK_PROSPECTING,
]);
// ═══════════════════════════════════════════════════════════════
// VISION TASK TYPES (routed to vision models)
// ═══════════════════════════════════════════════════════════════
const VISION_TASK_TYPES = new Set([
    TaskType.VISUAL_QA,
    TaskType.SCREENSHOT_ANALYSIS,
    TaskType.LAYOUT_VALIDATION,
]);
// ═══════════════════════════════════════════════════════════════
// THE ROUTER
// ═══════════════════════════════════════════════════════════════
export class L9LLMRouter {
    budget;
    perplexity;
    openrouter;
    callLog = [];
    constructor(config) {
        this.budget = new BudgetTracker(config.budget);
        this.perplexity = new PerplexityClient(config.perplexityApiKey);
        this.openrouter = new OpenRouterClient(config.openrouterApiKey, config.appName);
    }
    // ─────────────────────────────────────────────────────────────
    // MAIN ENTRY POINT
    // ─────────────────────────────────────────────────────────────
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
    async execute(task, systemPrompt, userPrompt, options) {
        const decision = this.route(task);
        // Check budget
        const throttle = this.budget.evaluateTask(task.clientId, task, decision.estimatedCost);
        if (!throttle.allowTask) {
            throw new BudgetExhaustedError(`Task deferred: ${throttle.reason}`, task, decision);
        }
        // Apply model downgrade if throttled (Fix #5: propagate downgrade to execution)
        if (throttle.forceDowngrade) {
            decision.downgraded = true;
            decision.downgradedFrom = decision.model;
            decision.model = this.getDowngradedModel(decision.model, throttle.maxModelTier);
        }
        // Execute based on provider
        let response;
        let billedCost;
        if (decision.provider === Provider.PERPLEXITY) {
            // Fix #5: Use decision.model (which may have been downgraded) for config override
            const config = resolvePerplexityConfig(task);
            if (decision.downgraded) {
                config.model = decision.model; // Apply downgraded model
            }
            if (options?.consensus && config.variations > 1) {
                const result = await this.perplexity.completeWithConsensus(config, systemPrompt, userPrompt, options.assistantContext);
                response = result.best;
                // Fix #6: Track total billed cost across all consensus calls, not just best
                billedCost = result.all.reduce((sum, r) => sum + r.cost, 0);
            }
            else {
                response = await this.perplexity.complete(config, systemPrompt, userPrompt, options?.assistantContext);
                billedCost = response.cost;
            }
        }
        else if (VISION_TASK_TYPES.has(task.type) && options?.images?.length) {
            const visionConfig = resolveVisionConfig(task.type, task.complexity, options.images.length);
            // Fix #5: Apply downgraded model to vision config
            if (decision.downgraded) {
                visionConfig.model = decision.model;
            }
            response = await this.openrouter.completeWithVision(visionConfig, systemPrompt, userPrompt, options.images);
            billedCost = response.cost;
        }
        else {
            const config = resolveGeneralConfig(task);
            // Fix #5: Apply downgraded model to general config
            if (decision.downgraded) {
                config.model = decision.model;
            }
            const fallbacks = getFallbackChain(config.model);
            response = await this.openrouter.completeWithFallback(config, fallbacks, systemPrompt, userPrompt);
            billedCost = response.cost;
        }
        // Record spend (Fix #6: use billedCost which includes all consensus calls)
        this.budget.recordSpend(task.clientId, billedCost);
        // Log the routing decision
        decision.actualCost = billedCost;
        decision.latencyMs = response.latencyMs;
        this.callLog.push(decision);
        return response;
    }
    // ─────────────────────────────────────────────────────────────
    // ROUTING LOGIC (deterministic, no LLM call)
    // ─────────────────────────────────────────────────────────────
    /**
     * Determine routing without executing.
     * Useful for cost estimation and planning.
     */
    route(task) {
        // Search tasks → Perplexity
        if (SEARCH_TASK_TYPES.has(task.type)) {
            const config = resolvePerplexityConfig(task);
            return {
                taskId: crypto.randomUUID(),
                clientId: task.clientId ?? 'default',
                taskType: task.type,
                complexity: task.complexity,
                provider: Provider.PERPLEXITY,
                model: config.model,
                estimatedCost: config.estimatedCostPerCall,
                reason: config.resolutionReason,
                timestamp: new Date().toISOString(),
            };
        }
        // Vision tasks → OpenRouter with vision model
        if (VISION_TASK_TYPES.has(task.type)) {
            const config = resolveVisionConfig(task.type, task.complexity);
            return {
                taskId: crypto.randomUUID(),
                clientId: task.clientId ?? 'default',
                taskType: task.type,
                complexity: task.complexity,
                provider: Provider.OPENROUTER,
                model: config.model,
                estimatedCost: config.estimatedCostPerCall,
                reason: config.resolutionReason,
                timestamp: new Date().toISOString(),
            };
        }
        // Everything else → OpenRouter general matrix
        const config = resolveGeneralConfig(task);
        return {
            taskId: crypto.randomUUID(),
            clientId: task.clientId ?? 'default',
            taskType: task.type,
            complexity: task.complexity,
            provider: Provider.OPENROUTER,
            model: config.model,
            estimatedCost: config.estimatedCostPerCall,
            reason: config.resolutionReason,
            timestamp: new Date().toISOString(),
        };
    }
    // ─────────────────────────────────────────────────────────────
    // CLIENT MANAGEMENT
    // ─────────────────────────────────────────────────────────────
    initClient(clientId, budgetOverrides) {
        this.budget.initClient(clientId, budgetOverrides);
    }
    resetDaily(clientId) {
        this.budget.resetDaily(clientId);
    }
    resetWeekly(clientId) {
        this.budget.resetWeekly(clientId);
    }
    resetMonthly(clientId) {
        this.budget.resetMonthly(clientId);
    }
    // ─────────────────────────────────────────────────────────────
    // REPORTING
    // ─────────────────────────────────────────────────────────────
    getClientBudgetReport(clientId) {
        return this.budget.getClientBudgetReport(clientId);
    }
    getAllBudgetReports() {
        return this.budget.getAllBudgetReports();
    }
    getGlobalSpend() {
        return this.budget.getGlobalSpend();
    }
    getCallLog(limit = 100) {
        return this.callLog.slice(-limit);
    }
    getCallLogByClient(clientId, limit = 50) {
        return this.callLog
            .filter(d => d.clientId === clientId)
            .slice(-limit);
    }
    // ─────────────────────────────────────────────────────────────
    // VISION QA HELPERS (convenience methods for consuming bots)
    // ─────────────────────────────────────────────────────────────
    /**
     * Generate a full-site visual QA plan.
     * The consuming bot takes the screenshots and calls execute() for each task.
     */
    planVisualQA(config) {
        return generateFullSiteQAPlan(config);
    }
    getViewports() {
        return VIEWPORTS;
    }
    // ─────────────────────────────────────────────────────────────
    // INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────
    getDowngradedModel(original, maxTier) {
        if (maxTier === 'fast') {
            return GeneralModel.GPT4O_MINI;
        }
        if (maxTier === 'strategic') {
            // If original was critical tier, downgrade to strategic
            if (original === GeneralModel.CLAUDE_OPUS ||
                original === GeneralModel.O1 ||
                original === GeneralModel.O3) {
                return GeneralModel.CLAUDE_SONNET;
            }
        }
        return original; // No downgrade needed
    }
}
// ═══════════════════════════════════════════════════════════════
// ERROR TYPES
// ═══════════════════════════════════════════════════════════════
export class BudgetExhaustedError extends Error {
    task;
    decision;
    constructor(message, task, decision) {
        super(message);
        this.task = task;
        this.decision = decision;
        this.name = 'BudgetExhaustedError';
    }
}
// ═══════════════════════════════════════════════════════════════
// RE-EXPORTS (consuming bots import everything from here)
// ═══════════════════════════════════════════════════════════════
export { TaskType, TaskComplexity, Provider, GeneralModel, SonarModel, } from './types.js';
export { BudgetTracker, ThrottleLevel } from './budget/index.js';
export { resolvePerplexityConfig } from './matrices/perplexity-matrix.js';
export { resolveGeneralConfig, getFallbackChain } from './matrices/general-matrix.js';
export { resolveVisionConfig, VIEWPORTS, VISUAL_QA_PROMPTS } from './vision/index.js';
//# sourceMappingURL=index.js.map