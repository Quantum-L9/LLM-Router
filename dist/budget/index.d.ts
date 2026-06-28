/**
 * @l9_meta
 * @module @quantum-l9/llm-router
 * @file src/budget/index.ts
 * @purpose Budget enforcement engine with trajectory-based throttling and surge awareness
 * @design No daily hard cap. Monthly budget per client. Weekly trajectory. Surge-aware.
 * @principle Never kill an autonomous reasoning task due to being cheap on token spend.
 */
import { BudgetState, BudgetConfig, TaskDescriptor } from '../types.js';
export declare const DEFAULT_BUDGET_CONFIG: BudgetConfig;
export declare enum ThrottleLevel {
    NONE = "none",// Full speed — no restrictions
    SOFT = "soft",// Prefer cheaper models, defer non-critical tasks
    HARD = "hard"
}
export interface ThrottleDecision {
    level: ThrottleLevel;
    reason: string;
    allowTask: boolean;
    forceDowngrade: boolean;
    maxModelTier: 'fast' | 'strategic' | 'critical';
}
export declare class BudgetTracker {
    private config;
    private clientStates;
    private globalMonthSpend;
    constructor(config?: Partial<BudgetConfig>);
    /**
     * Initialize or update a client's budget state.
     * Called at bot startup and after each billing period reset.
     */
    initClient(clientId: string, overrides?: Partial<BudgetConfig>): void;
    /**
     * Record a spend event after an LLM call completes.
     */
    recordSpend(clientId: string, amount: number): void;
    /**
     * Reset daily counters (called by scheduler at midnight).
     */
    resetDaily(clientId: string): void;
    /**
     * Reset weekly counters (called by scheduler on Monday).
     */
    resetWeekly(clientId: string): void;
    /**
     * Reset monthly counters (called by scheduler on 1st of month).
     */
    resetMonthly(clientId: string): void;
    resetGlobalMonthly(): void;
    /**
     * Determine whether a task should proceed and at what model tier.
     *
     * Key principle: NEVER kill an autonomous reasoning task due to budget.
     * Instead, downgrade the model tier or defer non-critical work.
     */
    evaluateTask(clientId: string, task: TaskDescriptor, estimatedCost: number): ThrottleDecision;
    /**
     * Check if surge is allowed.
     *
     * Logic: If it's Thursday or later and week spend is below 60% of target,
     * the bot has been quiet. Allow a surge up to the hard ceiling.
     * This prevents throttling an important reasoning chain just because
     * the bot was idle earlier in the week.
     */
    checkSurgeAllowance(clientId: string, dayOfWeek: number): boolean;
    private computeThrottleLevel;
    private getState;
    /**
     * Get current budget state for reporting.
     */
    getClientBudgetReport(clientId: string): BudgetState;
    /**
     * Get all clients' budget states for dashboard.
     */
    getAllBudgetReports(): BudgetState[];
    /**
     * Get global spend for operator dashboard.
     */
    getGlobalSpend(): {
        monthSpend: number;
        ceiling: number;
        utilization: number;
    };
}
//# sourceMappingURL=index.d.ts.map