import { describe, it, expect } from 'vitest';
import {
  resolveVisionConfig,
  buildLayoutValidationTask,
  buildCompetitorComparisonTask,
  buildConversionAuditTask,
  generateFullSiteQAPlan,
  VIEWPORTS,
} from '../src/vision/index.js';
import { GeneralModel, TaskComplexity, TaskType } from '../src/types.js';

describe('resolveVisionConfig', () => {
  it('uses the cheapest vision model for a single-image LOW complexity check', () => {
    const config = resolveVisionConfig(TaskType.VISUAL_QA, TaskComplexity.LOW, 1);
    expect(config.model).toBe(GeneralModel.GEMINI_FLASH_VISION);
    expect(config.detail).toBe('low');
  });

  it('uses GPT-4o high detail for MEDIUM complexity single-image checks', () => {
    const config = resolveVisionConfig(TaskType.VISUAL_QA, TaskComplexity.MEDIUM, 1);
    expect(config.model).toBe(GeneralModel.GPT4O_VISION);
    expect(config.detail).toBe('high');
  });

  it('routes multi-image comparisons at CRITICAL complexity to Claude', () => {
    const config = resolveVisionConfig(TaskType.SCREENSHOT_ANALYSIS, TaskComplexity.CRITICAL, 2);
    expect(config.model).toBe(GeneralModel.CLAUDE_SONNET_VISION);
    expect(config.resolutionReason).toMatch(/Multi-image comparison/);
  });

  it('produces a positive estimated cost for every resolved config', () => {
    for (const complexity of Object.values(TaskComplexity)) {
      const config = resolveVisionConfig(TaskType.VISUAL_QA, complexity, 1);
      expect(config.estimatedCostPerCall).toBeGreaterThan(0);
    }
  });

  // KNOWN BUG (pre-existing, out of scope for this PR): resolveVisionConfig
  // compares TaskComplexity with `<=`/`>=`, but TaskComplexity is a string
  // enum ('trivial'|'low'|'medium'|'high'|'critical'), so these are
  // lexicographic string comparisons rather than ordinal ones. Alphabetically
  // 'critical' < 'high' < 'low' < 'medium' < 'trivial', which inverts the
  // intended cost/quality ordering: HIGH and CRITICAL complexity single-image
  // tasks fall into the same "cheapest model" branch as LOW, while TRIVIAL
  // and MEDIUM land on the more expensive GPT-4o/high-detail branch. This
  // also defeats the LAYOUT_VALIDATION override (intended to always use
  // GPT-4o) for HIGH/CRITICAL complexity. These tests document the *actual*
  // current behavior; see PR remediation notes for the flagged defect and
  // proposed ordinal-comparison fix.
  it('documents the string-comparison quirk: HIGH/CRITICAL single-image checks fall through to the cheapest model', () => {
    for (const complexity of [TaskComplexity.HIGH, TaskComplexity.CRITICAL]) {
      const visualQa = resolveVisionConfig(TaskType.VISUAL_QA, complexity, 1);
      expect(visualQa.model).toBe(GeneralModel.GEMINI_FLASH_VISION);
      expect(visualQa.detail).toBe('low');

      // LAYOUT_VALIDATION is intended to always force GPT-4o, but the same
      // string-comparison bug short-circuits it for HIGH/CRITICAL too.
      const layout = resolveVisionConfig(TaskType.LAYOUT_VALIDATION, complexity, 1);
      expect(layout.model).toBe(GeneralModel.GEMINI_FLASH_VISION);
      expect(layout.detail).toBe('low');
    }
  });

  it('documents the string-comparison quirk: TRIVIAL/MEDIUM single-image checks land on the expensive model', () => {
    for (const complexity of [TaskComplexity.TRIVIAL, TaskComplexity.MEDIUM]) {
      const config = resolveVisionConfig(TaskType.VISUAL_QA, complexity, 1);
      expect(config.model).toBe(GeneralModel.GPT4O_VISION);
      expect(config.detail).toBe('high');
    }
  });
});

describe('task builders', () => {
  it('buildLayoutValidationTask attaches the layout prompt and a single screenshot', () => {
    const task = buildLayoutValidationTask('https://example.com/shot.png', VIEWPORTS.desktop_1920);
    expect(task.images).toEqual(['https://example.com/shot.png']);
    expect(task.viewport).toBe(VIEWPORTS.desktop_1920);
    expect(task.prompt).toMatch(/senior web designer/);
  });

  it('buildCompetitorComparisonTask attaches both screenshots in order', () => {
    const task = buildCompetitorComparisonTask('https://ours.com/a.png', 'https://competitor.com/b.png', VIEWPORTS.mobile_iphone);
    expect(task.images).toEqual(['https://ours.com/a.png', 'https://competitor.com/b.png']);
    expect(task.prompt).toMatch(/comparing two website screenshots/);
  });

  it('buildConversionAuditTask attaches the conversion prompt and a single screenshot', () => {
    const task = buildConversionAuditTask('https://example.com/landing.png', VIEWPORTS.tablet_ipad);
    expect(task.images).toEqual(['https://example.com/landing.png']);
    expect(task.prompt).toMatch(/conversion rate optimization/);
  });
});

describe('generateFullSiteQAPlan', () => {
  it('generates one layout validation task per page × viewport combination', () => {
    const plan = generateFullSiteQAPlan({
      pages: ['https://example.com/', 'https://example.com/pricing'],
      viewports: [VIEWPORTS.desktop_1920, VIEWPORTS.mobile_iphone],
      conversionAudit: false,
    });
    const layoutTasks = plan.filter((t) => t.prompt.match(/senior web designer/));
    expect(layoutTasks).toHaveLength(4);
  });

  it('adds competitor comparison tasks for at most the first 3 pages when a competitor URL is set', () => {
    const plan = generateFullSiteQAPlan({
      pages: ['/a', '/b', '/c', '/d'],
      viewports: [VIEWPORTS.desktop_1440],
      competitorUrl: 'https://competitor.com',
      conversionAudit: false,
    });
    const comparisonTasks = plan.filter((t) => t.images.includes('https://competitor.com'));
    expect(comparisonTasks).toHaveLength(3);
  });

  it('adds conversion audit tasks for at most the first 2 pages when enabled', () => {
    const plan = generateFullSiteQAPlan({
      pages: ['/a', '/b', '/c'],
      viewports: [VIEWPORTS.desktop_1440],
      conversionAudit: true,
    });
    const auditTasks = plan.filter((t) => t.prompt.match(/conversion rate optimization/));
    expect(auditTasks).toHaveLength(2);
  });

  it('omits competitor and conversion tasks when neither is requested', () => {
    const plan = generateFullSiteQAPlan({
      pages: ['/a'],
      viewports: [VIEWPORTS.desktop_1440],
      conversionAudit: false,
    });
    expect(plan).toHaveLength(1);
  });
});
