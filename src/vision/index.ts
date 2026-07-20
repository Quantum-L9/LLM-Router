import { GeneralModel, Provider, TaskComplexity, TaskType } from '../types.js';
export interface ViewportConfig { name: string; width: number; height: number; deviceScaleFactor: number; isMobile: boolean }
export interface VisionConfig { model: GeneralModel; provider: Provider; maxTokens: number; detail: 'low' | 'high' | 'auto'; estimatedCostPerCall: number; resolutionReason: string }
export interface VisualQATask { prompt: string; images: string[]; viewport: ViewportConfig; config: VisionConfig }
export interface FullSiteQAConfig { pages: string[]; viewports: ViewportConfig[]; competitorUrl?: string; conversionAudit: boolean }
export const VIEWPORTS: Record<string, ViewportConfig> = { desktop_1440: { name: 'Desktop 1440', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false }, mobile_iphone: { name: 'iPhone', width: 393, height: 852, deviceScaleFactor: 3, isMobile: true } };
export function resolveVisionConfig(_type: TaskType, complexity: TaskComplexity): VisionConfig { return { model: complexity >= TaskComplexity.HIGH ? GeneralModel.CLAUDE_SONNET : GeneralModel.GPT4O, provider: Provider.OPENROUTER, maxTokens: 2048, detail: 'auto', estimatedCostPerCall: 0.02, resolutionReason: 'vision' }; }
export function generateFullSiteQAPlan(config: FullSiteQAConfig): VisualQATask[] { return config.pages.flatMap(page => config.viewports.map(viewport => ({ prompt: 'Analyze screenshot', images: [page], viewport, config: resolveVisionConfig(TaskType.VISUAL_QA, TaskComplexity.MEDIUM) }))); }
