import { describe, expect, it } from 'vitest';
import { GeneralModel, Provider, SonarModel, TaskComplexity, TaskType } from '../src/types.js';
import { getDowngradedModel, L9LLMRouter, resolveRoute } from '../src/index.js';

describe('routing remediation', () => {
  it('keeps pure route resolution deterministic', () => {
    const task = { type: TaskType.CLASSIFICATION, complexity: TaskComplexity.MEDIUM, clientId: 'a' };
    expect(resolveRoute(task)).toEqual(resolveRoute({ ...task }));
  });

  it('validates public route input', () => {
    const router = new L9LLMRouter({ perplexityApiKey: 'p', openrouterApiKey: 'o' }, { idFactory: () => 'id', clock: () => new Date('2026-01-01T00:00:00Z') });
    expect(() => router.route({ type: 'bogus', complexity: 'medium' } as never)).toThrow(/Invalid TaskDescriptor/);
  });

  it('keeps volatile decision fields outside routing equivalence', () => {
    let id = 0;
    const router = new L9LLMRouter({ perplexityApiKey: 'p', openrouterApiKey: 'o' }, { idFactory: () => `id-${++id}`, clock: () => new Date('2026-01-01T00:00:00Z') });
    const task = { type: TaskType.EXTRACTION, complexity: TaskComplexity.LOW };
    const first = router.route(task);
    const second = router.route(task);
    expect(first.taskId).not.toBe(second.taskId);
    expect({ ...first, taskId: '', timestamp: '' }).toEqual({ ...second, taskId: '', timestamp: '' });
  });

  it('never crosses provider families during downgrade', () => {
    expect(getDowngradedModel(SonarModel.SONAR_DEEP_RESEARCH, Provider.PERPLEXITY, 'fast')).toBe(SonarModel.SONAR);
    expect(getDowngradedModel(GeneralModel.CLAUDE_OPUS, Provider.OPENROUTER, 'strategic')).toBe(GeneralModel.CLAUDE_SONNET);
  });
});
