import { describe, it, expect } from 'vitest';
import { resolvePerplexityConfig, estimatePerplexityCost } from '../src/matrices/perplexity-matrix.js';
import {
  SonarModel,
  SearchContextSize,
  RecencyFilter,
  MessageStrategy,
  TaskComplexity,
  TaskType,
  type TaskDescriptor,
} from '../src/types.js';

function task(overrides: Partial<TaskDescriptor> = {}): TaskDescriptor {
  return {
    type: TaskType.COMPETITOR_RESEARCH,
    complexity: TaskComplexity.MEDIUM,
    ...overrides,
  };
}

describe('resolvePerplexityConfig', () => {
  it('resolves COMPETITOR_RESEARCH/TRIVIAL to the base sonar model with recency=week', () => {
    const config = resolvePerplexityConfig(task({ complexity: TaskComplexity.TRIVIAL }));
    expect(config.model).toBe(SonarModel.SONAR);
    expect(config.recencyFilter).toBe(RecencyFilter.WEEK);
    expect(config.disableSearch).toBe(false); // COMPETITOR_RESEARCH is a search task
  });

  it('escalates to deep research + high context + 5 variations at CRITICAL complexity', () => {
    const config = resolvePerplexityConfig(task({ complexity: TaskComplexity.CRITICAL }));
    expect(config.model).toBe(SonarModel.SONAR_DEEP_RESEARCH);
    expect(config.searchContextSize).toBe(SearchContextSize.HIGH);
    expect(config.variations).toBe(5);
  });

  it('gives HIGH complexity tasks 3 variations and assistant-context message strategy', () => {
    const config = resolvePerplexityConfig(task({ complexity: TaskComplexity.HIGH }));
    expect(config.variations).toBe(3);
    expect(config.messageStrategy).toBe(MessageStrategy.SYSTEM_USER_ASSISTANT);
  });

  it('uses assistant-context messages at TRIVIAL/LOW/MEDIUM complexity (string-comparison quirk)', () => {
    // KNOWN BUG (pre-existing, out of scope for this PR): resolveMessageStrategy
    // compares `task.complexity >= TaskComplexity.HIGH` as a plain string
    // comparison, not an ordinal complexity comparison. Alphabetically,
    // 'trivial' > 'low' > 'medium' > 'high' > 'critical', so every level
    // EXCEPT critical satisfies ">= HIGH" here — the opposite of intent.
    // This test documents the *actual* current behavior; see PR remediation
    // notes for the flagged defect and proposed ordinal fix.
    for (const complexity of [TaskComplexity.TRIVIAL, TaskComplexity.LOW, TaskComplexity.MEDIUM]) {
      const config = resolvePerplexityConfig(task({ complexity }));
      expect(config.messageStrategy).toBe(MessageStrategy.SYSTEM_USER_ASSISTANT);
    }
  });

  it('uses plain system/user messages at CRITICAL complexity for a non-reasoning task', () => {
    const config = resolvePerplexityConfig(task({ complexity: TaskComplexity.CRITICAL }));
    expect(config.messageStrategy).toBe(MessageStrategy.SYSTEM_USER);
  });

  it('respects an explicit recency override even for tasks with a default', () => {
    const config = resolvePerplexityConfig(task({ recency: RecencyFilter.HOUR }));
    expect(config.recencyFilter).toBe(RecencyFilter.HOUR);
  });

  it('defaults CITATION_CHECK to LOW search context and MONTH recency', () => {
    const config = resolvePerplexityConfig(task({ type: TaskType.CITATION_CHECK, complexity: TaskComplexity.LOW }));
    expect(config.searchContextSize).toBe(SearchContextSize.LOW);
    expect(config.recencyFilter).toBe(RecencyFilter.MONTH);
  });

  it('sets disableSearch=true for non-search tasks without an explicit requiresSearch flag', () => {
    const config = resolvePerplexityConfig(task({ type: TaskType.CLASSIFICATION, complexity: TaskComplexity.LOW }));
    expect(config.disableSearch).toBe(true);
  });

  it('sets disableSearch=false when requiresSearch is explicitly set, even for a non-search task type', () => {
    const config = resolvePerplexityConfig(
      task({ type: TaskType.CLASSIFICATION, complexity: TaskComplexity.LOW, requiresSearch: true }),
    );
    expect(config.disableSearch).toBe(false);
  });

  it('sets reasoningEffort only for reasoning-tier models, scaled by complexity', () => {
    const highReasoning = resolvePerplexityConfig(
      task({ type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.HIGH }),
    );
    expect(highReasoning.model).toBe(SonarModel.SONAR_REASONING_PRO);
    expect(highReasoning.reasoningEffort).toBe('medium');

    const criticalReasoning = resolvePerplexityConfig(
      task({ type: TaskType.CITATION_CHECK, complexity: TaskComplexity.CRITICAL }),
    );
    expect(criticalReasoning.model).toBe(SonarModel.SONAR_REASONING_PRO);
    expect(criticalReasoning.reasoningEffort).toBe('high');

    const nonReasoning = resolvePerplexityConfig(task({ complexity: TaskComplexity.MEDIUM }));
    expect(nonReasoning.reasoningEffort).toBeUndefined();
  });

  it('propagates an empty domainFilter by default and echoes an explicit one', () => {
    const withoutFilter = resolvePerplexityConfig(task());
    expect(withoutFilter.domainFilter).toEqual([]);

    const withFilter = resolvePerplexityConfig(task({ domainFilter: ['example.com'] }));
    expect(withFilter.domainFilter).toEqual(['example.com']);
  });

  it('produces a positive estimated cost consistent with estimatePerplexityCost', () => {
    const config = resolvePerplexityConfig(task());
    expect(config.estimatedCostPerCall).toBeGreaterThan(0);
    expect(config.estimatedCostPerCall).toBe(estimatePerplexityCost(config));
  });
});

describe('estimatePerplexityCost', () => {
  it('scales with the number of variations', () => {
    const base = resolvePerplexityConfig(task({ complexity: TaskComplexity.MEDIUM }));
    const oneVariation = estimatePerplexityCost({ ...base, variations: 1 });
    const threeVariations = estimatePerplexityCost({ ...base, variations: 3 });
    expect(threeVariations).toBeCloseTo(oneVariation * 3, 5);
  });

  it('charges more for HIGH context than LOW context at the same token budget', () => {
    const base = resolvePerplexityConfig(task());
    const low = estimatePerplexityCost({ ...base, searchContextSize: SearchContextSize.LOW });
    const high = estimatePerplexityCost({ ...base, searchContextSize: SearchContextSize.HIGH });
    expect(high).toBeGreaterThan(low);
  });
});
