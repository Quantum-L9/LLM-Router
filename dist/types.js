/**
 * @l9_meta
 * @module @quantum-l9/llm-router
 * @file src/types.ts
 * @purpose Core type definitions for the multi-provider LLM routing system
 * @shared_by All L9 bots (SEO Bot, Website Factory, future bots)
 */
// ═══════════════════════════════════════════════════════════════
// PROVIDER ENUMS
// ═══════════════════════════════════════════════════════════════
export var Provider;
(function (Provider) {
    Provider["OPENROUTER"] = "openrouter";
    Provider["PERPLEXITY"] = "perplexity";
    Provider["OPENAI_DIRECT"] = "openai_direct";
    Provider["ANTHROPIC_DIRECT"] = "anthropic_direct";
})(Provider || (Provider = {}));
// ═══════════════════════════════════════════════════════════════
// MODEL REGISTRIES
// ═══════════════════════════════════════════════════════════════
/** Perplexity Sonar model tiers — aligned with Enrichment.Inference.Engine */
export var SonarModel;
(function (SonarModel) {
    SonarModel["SONAR"] = "sonar";
    SonarModel["SONAR_PRO"] = "sonar-pro";
    SonarModel["SONAR_REASONING"] = "sonar-reasoning";
    SonarModel["SONAR_REASONING_PRO"] = "sonar-reasoning-pro";
    SonarModel["SONAR_DEEP_RESEARCH"] = "sonar-deep-research";
})(SonarModel || (SonarModel = {}));
/** OpenRouter-accessible models — the general-purpose matrix */
export var GeneralModel;
(function (GeneralModel) {
    // Fast tier (< $1/M tokens) — classification, extraction, scoring
    GeneralModel["GPT4O_MINI"] = "openai/gpt-4o-mini";
    GeneralModel["GEMINI_FLASH"] = "google/gemini-2.5-flash";
    GeneralModel["CLAUDE_HAIKU"] = "anthropic/claude-haiku-4";
    // Strategic tier ($1-10/M tokens) — generation, reasoning, planning
    GeneralModel["GPT4O"] = "openai/gpt-4o";
    GeneralModel["CLAUDE_SONNET"] = "anthropic/claude-sonnet-4";
    GeneralModel["GEMINI_PRO"] = "google/gemini-2.5-pro";
    // Critical tier ($10+/M tokens) — complex strategy, multi-step reasoning
    GeneralModel["CLAUDE_OPUS"] = "anthropic/claude-opus-4";
    GeneralModel["O1"] = "openai/o1";
    GeneralModel["O3"] = "openai/o3";
    // Vision tier — visual QA, screenshot analysis
    GeneralModel["GPT4O_VISION"] = "openai/gpt-4o";
    GeneralModel["CLAUDE_SONNET_VISION"] = "anthropic/claude-sonnet-4";
    GeneralModel["GEMINI_FLASH_VISION"] = "google/gemini-2.5-flash";
})(GeneralModel || (GeneralModel = {}));
// ═══════════════════════════════════════════════════════════════
// PERPLEXITY SEARCH DIMENSIONS (from Enrichment.Inference.Engine)
// ═══════════════════════════════════════════════════════════════
export var SearchContextSize;
(function (SearchContextSize) {
    SearchContextSize["LOW"] = "low";
    SearchContextSize["MEDIUM"] = "medium";
    SearchContextSize["HIGH"] = "high";
})(SearchContextSize || (SearchContextSize = {}));
export var SearchMode;
(function (SearchMode) {
    SearchMode["WEB"] = "web";
    SearchMode["ACADEMIC"] = "academic";
    SearchMode["SEC"] = "sec";
})(SearchMode || (SearchMode = {}));
export var RecencyFilter;
(function (RecencyFilter) {
    RecencyFilter["HOUR"] = "hour";
    RecencyFilter["DAY"] = "day";
    RecencyFilter["WEEK"] = "week";
    RecencyFilter["MONTH"] = "month";
    RecencyFilter["YEAR"] = "year";
    RecencyFilter["NONE"] = "none";
})(RecencyFilter || (RecencyFilter = {}));
export var MessageStrategy;
(function (MessageStrategy) {
    MessageStrategy["SYSTEM_USER"] = "system_user";
    MessageStrategy["SYSTEM_USER_ASSISTANT"] = "system_user_asst";
})(MessageStrategy || (MessageStrategy = {}));
// ═══════════════════════════════════════════════════════════════
// TASK CLASSIFICATION
// ═══════════════════════════════════════════════════════════════
/** Task complexity levels — determines model tier selection */
export var TaskComplexity;
(function (TaskComplexity) {
    TaskComplexity["TRIVIAL"] = "trivial";
    TaskComplexity["LOW"] = "low";
    TaskComplexity["MEDIUM"] = "medium";
    TaskComplexity["HIGH"] = "high";
    TaskComplexity["CRITICAL"] = "critical";
})(TaskComplexity || (TaskComplexity = {}));
/** Task type categories — determines provider selection */
export var TaskType;
(function (TaskType) {
    // Pure generation (no search needed)
    TaskType["CLASSIFICATION"] = "classification";
    TaskType["EXTRACTION"] = "extraction";
    TaskType["SCORING"] = "scoring";
    TaskType["CONTENT_GENERATION"] = "content_generation";
    TaskType["STRATEGIC_REASONING"] = "strategic_reasoning";
    TaskType["CODE_GENERATION"] = "code_generation";
    // Search-grounded (Perplexity preferred)
    TaskType["COMPETITOR_RESEARCH"] = "competitor_research";
    TaskType["CITATION_CHECK"] = "citation_check";
    TaskType["FACT_VERIFICATION"] = "fact_verification";
    TaskType["MARKET_RESEARCH"] = "market_research";
    TaskType["LINK_PROSPECTING"] = "link_prospecting";
    // Vision (requires multimodal)
    TaskType["VISUAL_QA"] = "visual_qa";
    TaskType["SCREENSHOT_ANALYSIS"] = "screenshot_analysis";
    TaskType["LAYOUT_VALIDATION"] = "layout_validation";
})(TaskType || (TaskType = {}));
//# sourceMappingURL=types.js.map