/**
 * @l9_meta
 * @module @quantum-l9/llm-router
 * @file src/vision/index.ts
 * @purpose Visual QA engine — uses vision models to "see" sites like a human would
 * @use_case Layout validation, alignment checks, mobile/desktop rendering QA
 * @answer_to "Can/should we use GPT's built-in vision to see the site?"
 *
 * YES. The Vision QA module captures screenshots at desktop and mobile viewports,
 * then uses vision-capable LLMs to detect:
 * - Misaligned elements
 * - Overlapping text
 * - Broken layouts
 * - Missing images (broken img tags)
 * - Color contrast issues visible to the eye
 * - CTA visibility and prominence
 * - Overall professional appearance
 *
 * This is NOT a replacement for automated testing (Lighthouse, axe-core).
 * It's the "human eye" check that catches things automated tools miss.
 */
import { TaskComplexity, TaskType, VisionConfig } from '../types.js';
export interface ViewportConfig {
    name: string;
    width: number;
    height: number;
    deviceScaleFactor: number;
    isMobile: boolean;
    userAgent?: string;
}
export declare const VIEWPORTS: Record<string, ViewportConfig>;
export declare const VISUAL_QA_PROMPTS: {
    layout_validation: string;
    competitor_comparison: string;
    conversion_audit: string;
};
export declare function resolveVisionConfig(taskType: TaskType.VISUAL_QA | TaskType.SCREENSHOT_ANALYSIS | TaskType.LAYOUT_VALIDATION, complexity: TaskComplexity, imageCount?: number): VisionConfig;
export interface VisualQATask {
    prompt: string;
    images: string[];
    viewport: ViewportConfig;
    config: VisionConfig;
}
/**
 * Build a layout validation task for a specific page and viewport.
 * The calling bot is responsible for taking the screenshot.
 */
export declare function buildLayoutValidationTask(screenshotUrl: string, viewport: ViewportConfig, complexity?: TaskComplexity): VisualQATask;
/**
 * Build a competitor comparison task with two screenshots.
 */
export declare function buildCompetitorComparisonTask(ourScreenshotUrl: string, competitorScreenshotUrl: string, viewport: ViewportConfig): VisualQATask;
/**
 * Build a conversion audit task for a landing page.
 */
export declare function buildConversionAuditTask(screenshotUrl: string, viewport: ViewportConfig): VisualQATask;
export interface FullSiteQAConfig {
    /** URLs to check */
    pages: string[];
    /** Which viewports to test */
    viewports: ViewportConfig[];
    /** Whether to do competitor comparison */
    competitorUrl?: string;
    /** Whether to do conversion audit on landing pages */
    conversionAudit: boolean;
}
/**
 * Generates the complete set of visual QA tasks for a full site audit.
 * The calling bot executes these tasks and aggregates results.
 *
 * Cost estimate for a 5-page site, 3 viewports:
 * - Layout validation: 5 pages × 3 viewports × $0.015 = $0.225
 * - Competitor comparison: 5 pages × 1 viewport × $0.03 = $0.15
 * - Conversion audit: 2 landing pages × $0.015 = $0.03
 * - Total: ~$0.40 per full site audit
 *
 * Run weekly = ~$1.60/month per client for visual QA
 */
export declare function generateFullSiteQAPlan(config: FullSiteQAConfig): VisualQATask[];
//# sourceMappingURL=index.d.ts.map