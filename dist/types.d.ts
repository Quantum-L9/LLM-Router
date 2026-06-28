/**
 * @l9_meta
 * @module @quantum-l9/llm-router
 * @file src/types.ts
 * @purpose Core type definitions for the multi-provider LLM routing system
 * @shared_by All L9 bots (SEO Bot, Website Factory, future bots)
 */
export declare enum Provider {
    OPENROUTER = "openrouter",
    PERPLEXITY = "perplexity",
    OPENAI_DIRECT = "openai_direct",
    ANTHROPIC_DIRECT = "anthropic_direct"
}
/** Perplexity Sonar model tiers — aligned with Enrichment.Inference.Engine */
export declare enum SonarModel {
    SONAR = "sonar",
    SONAR_PRO = "sonar-pro",
    SONAR_REASONING = "sonar-reasoning",
    SONAR_REASONING_PRO = "sonar-reasoning-pro",
    SONAR_DEEP_RESEARCH = "sonar-deep-research"
}
/** OpenRouter-accessible models — the general-purpose matrix */
export declare enum GeneralModel {
    GPT4O_MINI = "openai/gpt-4o-mini",
    GEMINI_FLASH = "google/gemini-2.5-flash",
    CLAUDE_HAIKU = "anthropic/claude-haiku-4",
    GPT4O = "openai/gpt-4o",
    CLAUDE_SONNET = "anthropic/claude-sonnet-4",
    GEMINI_PRO = "google/gemini-2.5-pro",
    CLAUDE_OPUS = "anthropic/claude-opus-4",
    O1 = "openai/o1",
    O3 = "openai/o3",
    GPT4O_VISION = "openai/gpt-4o",
    CLAUDE_SONNET_VISION = "anthropic/claude-sonnet-4",
    GEMINI_FLASH_VISION = "google/gemini-2.5-flash"
}
export declare enum SearchContextSize {
    LOW = "low",
    MEDIUM = "medium",
    HIGH = "high"
}
export declare enum SearchMode {
    WEB = "web",
    ACADEMIC = "academic",
    SEC = "sec"
}
export declare enum RecencyFilter {
    HOUR = "hour",
    DAY = "day",
    WEEK = "week",
    MONTH = "month",
    YEAR = "year",
    NONE = "none"
}
export declare enum MessageStrategy {
    SYSTEM_USER = "system_user",
    SYSTEM_USER_ASSISTANT = "system_user_asst"
}
/** Task complexity levels — determines model tier selection */
export declare enum TaskComplexity {
    TRIVIAL = "trivial",// Boolean check, simple extraction
    LOW = "low",// Classification, scoring, short generation
    MEDIUM = "medium",// Content generation, summarization
    HIGH = "high",// Strategic reasoning, multi-step planning
    CRITICAL = "critical"
}
/** Task type categories — determines provider selection */
export declare enum TaskType {
    CLASSIFICATION = "classification",
    EXTRACTION = "extraction",
    SCORING = "scoring",
    CONTENT_GENERATION = "content_generation",
    STRATEGIC_REASONING = "strategic_reasoning",
    CODE_GENERATION = "code_generation",
    COMPETITOR_RESEARCH = "competitor_research",
    CITATION_CHECK = "citation_check",
    FACT_VERIFICATION = "fact_verification",
    MARKET_RESEARCH = "market_research",
    LINK_PROSPECTING = "link_prospecting",
    VISUAL_QA = "visual_qa",
    SCREENSHOT_ANALYSIS = "screenshot_analysis",
    LAYOUT_VALIDATION = "layout_validation"
}
/** Resolved Perplexity search configuration */
export interface PerplexityConfig {
    model: SonarModel;
    searchContextSize: SearchContextSize;
    searchMode: SearchMode;
    recencyFilter: RecencyFilter;
    messageStrategy: MessageStrategy;
    temperature: number;
    maxTokens: number;
    domainFilter: string[];
    variations: number;
    reasoningEffort?: string;
    disableSearch: boolean;
    estimatedCostPerCall: number;
    resolutionReason: string;
}
/** Resolved general model configuration */
export interface GeneralModelConfig {
    model: GeneralModel;
    provider: Provider;
    temperature: number;
    maxTokens: number;
    responseFormat?: 'json' | 'text';
    estimatedCostPerCall: number;
    resolutionReason: string;
}
/** Resolved vision configuration */
export interface VisionConfig {
    model: GeneralModel;
    provider: Provider;
    maxTokens: number;
    detail: 'low' | 'high' | 'auto';
    estimatedCostPerCall: number;
    resolutionReason: string;
}
/** Union of all resolved configs */
export type ResolvedConfig = PerplexityConfig | GeneralModelConfig | VisionConfig;
export interface TaskDescriptor {
    /** What type of task is this? */
    type: TaskType;
    /** How complex is the reasoning required? */
    complexity: TaskComplexity;
    /** Expected output token count (helps select model tier) */
    expectedOutputTokens?: number;
    /** Does this task require multi-step reasoning? */
    requiresReasoning?: boolean;
    /** Does this task need web search grounding? */
    requiresSearch?: boolean;
    /** How recent must the search results be? */
    recency?: RecencyFilter;
    /** Domain filter for Perplexity searches */
    domainFilter?: string[];
    /** For vision tasks: the image URLs or base64 data */
    images?: string[];
    /** For vision tasks: viewport type */
    viewport?: 'desktop' | 'mobile';
    /** Client ID for budget tracking */
    clientId?: string;
    /** Human-readable description for logging */
    description?: string;
}
export interface RoutingResult {
    /** The resolved configuration to use */
    config: ResolvedConfig;
    /** Which provider handles this request */
    provider: Provider;
    /** Estimated cost for this call */
    estimatedCost: number;
    /** Why this route was chosen */
    reason: string;
    /** Fallback chain if primary fails */
    fallbacks: ResolvedConfig[];
    /** Was this request budget-gated? */
    budgetGated: boolean;
}
export interface BudgetState {
    clientId: string;
    monthlyBudget: number;
    monthSpend: number;
    weekSpend: number;
    weekTarget: number;
    todaySpend: number;
    weeklyHardCeiling: number;
    surgeAllowance: boolean;
    remainingMonthly: number;
    remainingWeekly: number;
    throttleLevel: 'none' | 'soft' | 'hard';
}
export interface BudgetConfig {
    monthlyBudgetPerClient: number;
    weeklyTarget: number;
    weeklyHardCeiling: number;
    globalMonthlyHardCeiling: number;
    surgeThreshold: number;
}
export interface LLMResponse {
    content: string;
    model: string;
    provider: Provider;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    latencyMs: number;
    cached: boolean;
    citations?: string[];
    searchResults?: Record<string, unknown>[];
}
export interface RouterConfig {
    perplexityApiKey: string;
    openrouterApiKey: string;
    appName?: string;
    budget?: Partial<BudgetConfig>;
}
export interface RoutingDecision {
    taskId: string;
    clientId: string;
    taskType: TaskType;
    complexity: TaskComplexity;
    provider: Provider;
    model: GeneralModel | SonarModel | string;
    estimatedCost: number;
    actualCost?: number;
    latencyMs?: number;
    reason: string;
    timestamp: string;
    downgraded?: boolean;
    downgradedFrom?: GeneralModel | SonarModel | string;
}
export interface CircuitBreakerState {
    provider: Provider;
    state: 'closed' | 'open' | 'half-open';
    failureCount: number;
    lastFailure?: Date;
    nextRetryAt?: Date;
}
//# sourceMappingURL=types.d.ts.map