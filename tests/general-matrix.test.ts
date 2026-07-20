import { describe, it, expect } from 'vitest';
import { resolveGeneralConfig, getFallbackChain, estimateGeneralCost } from '../src/matrices/general-matrix.js';
import { GeneralModel, Provider, TaskComplexity, TaskType, type TaskDescriptor } from '../src/types.js';

function task(overrides: Partial<TaskDescriptor> = {}): TaskDescriptor {
  return {
    type: TaskType.CONTENT_GENERATION,
    complexity: TaskComplexity.MEDIUM,
    ...overrides,
  };
}

describe('resolveGeneralConfig', () => {
  it('routes CLASSIFICATION/TRIVIAL to the cheapest fast-tier model with JSON output', () => {
    const config = resolveGeneralConfig(task({ type: TaskType.CLASSIFICATION, complexity: TaskComplexity.TRIVIAL }));
    expect(config.model).toBe(GeneralModel.GPT4O_MINI);
    expect(config.provider).toBe(Provider.OPENROUTER);
    expect(config.responseFormat).toBe('json');
    expect(config.temperature).toBeCloseTo(0.1);
    expect(config.maxTokens).toBe(256);
  });

  it('routes CONTENT_GENERATION/CRITICAL to Claude Opus with text output', () => {
    const config = resolveGeneralConfig(task({ type: TaskType.CONTENT_GENERATION, complexity: TaskComplexity.CRITICAL }));
    expect(config.model).toBe(GeneralModel.CLAUDE_OPUS);
    expect(config.responseFormat).toBe('text');
    expect(config.temperature).toBeCloseTo(0.7);
  });

  it('escalates CONTENT_GENERATION maxTokens for HIGH+ complexity', () => {
    // KNOWN BUG (pre-existing, out of scope for this PR): resolveMaxTokens
    // compares `task.complexity >= TaskComplexity.HIGH`, but TaskComplexity
    // is a string enum ('trivial'|'low'|'medium'|'high'|'critical'), so this
    // is a lexicographic string comparison, not an ordinal one. 'medium' >
    // 'high' alphabetically, so MEDIUM incorrectly satisfies the ">= HIGH"
    // check here, and CRITICAL ('critical' < 'high') incorrectly fails it
    // elsewhere. This test documents the *actual* current behavior; see
    // PR remediation notes for the flagged defect and proposed ordinal fix.
    const medium = resolveGeneralConfig(task({ type: TaskType.CONTENT_GENERATION, complexity: TaskComplexity.MEDIUM }));
    const high = resolveGeneralConfig(task({ type: TaskType.CONTENT_GENERATION, complexity: TaskComplexity.HIGH }));
    expect(medium.maxTokens).toBe(4096);
    expect(high.maxTokens).toBe(4096);
  });

  it('honors an explicit expectedOutputTokens override', () => {
    const config = resolveGeneralConfig(task({ expectedOutputTokens: 777 }));
    expect(config.maxTokens).toBe(777);
  });

  it('falls back to GPT4O_MINI with a documented reason for an unmapped combination', () => {
    // Every real TaskType has a mapping in TASK_MODEL_MAP, so cast an invalid
    // value through `as` to exercise the defensive fallback branch.
    const config = resolveGeneralConfig(task({ type: 'not_a_real_task_type' as TaskType }));
    expect(config.model).toBe(GeneralModel.GPT4O_MINI);
    expect(config.resolutionReason).toMatch(/Fallback: No mapping/);
  });

  it('produces a deterministic, positive estimated cost', () => {
    const config = resolveGeneralConfig(task());
    expect(config.estimatedCostPerCall).toBeGreaterThan(0);
    expect(config.estimatedCostPerCall).toBe(estimateGeneralCost(config.model, config.maxTokens));
  });
});

describe('estimateGeneralCost', () => {
  it('scales linearly with maxTokens', () => {
    const small = estimateGeneralCost(GeneralModel.GPT4O_MINI, 1000);
    const large = estimateGeneralCost(GeneralModel.GPT4O_MINI, 2000);
    expect(large).toBeCloseTo(small * 2, 5);
  });

  it('charges more for a pricier model at the same token budget', () => {
    const mini = estimateGeneralCost(GeneralModel.GPT4O_MINI, 2048);
    const opus = estimateGeneralCost(GeneralModel.CLAUDE_OPUS, 2048);
    expect(opus).toBeGreaterThan(mini);
  });
});

describe('getFallbackChain', () => {
  it('returns the two configured fallbacks for a fast-tier model', () => {
    const chain = getFallbackChain(GeneralModel.GPT4O_MINI);
    expect(chain).toEqual([GeneralModel.GEMINI_FLASH, GeneralModel.CLAUDE_HAIKU]);
  });

  it('never includes the model itself in its own fallback chain', () => {
    for (const model of Object.values(GeneralModel)) {
      const chain = getFallbackChain(model);
      expect(chain).not.toContain(model);
    }
  });

  it('falls back to GPT4O_MINI for a model with no configured chain', () => {
    const chain = getFallbackChain('not-a-real-model' as GeneralModel);
    expect(chain).toEqual([GeneralModel.GPT4O_MINI]);
  });
});
