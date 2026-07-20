import { describe, it, expect, beforeEach } from 'vitest';
import { L9LLMRouter, BudgetExhaustedError } from '../src/index.js';
import { Provider, TaskComplexity, TaskType, type TaskDescriptor } from '../src/types.js';

function router(): L9LLMRouter {
  const r = new L9LLMRouter({
    perplexityApiKey: 'test-perplexity-key',
    openrouterApiKey: 'test-openrouter-key',
    appName: 'l9-router-tests',
  });
  r.initClient('acme');
  return r;
}

function task(overrides: Partial<TaskDescriptor> = {}): TaskDescriptor {
  return {
    type: TaskType.CONTENT_GENERATION,
    complexity: TaskComplexity.MEDIUM,
    clientId: 'acme',
    ...overrides,
  };
}

describe('L9LLMRouter.route', () => {
  let r: L9LLMRouter;

  beforeEach(() => {
    r = router();
  });

  it('routes search task types to Perplexity', () => {
    const decision = r.route(task({ type: TaskType.COMPETITOR_RESEARCH }));
    expect(decision.provider).toBe(Provider.PERPLEXITY);
    expect(decision.taskType).toBe(TaskType.COMPETITOR_RESEARCH);
    expect(decision.estimatedCost).toBeGreaterThan(0);
  });

  it('routes vision task types to OpenRouter with a vision model', () => {
    const decision = r.route(task({ type: TaskType.VISUAL_QA }));
    expect(decision.provider).toBe(Provider.OPENROUTER);
    expect(decision.taskType).toBe(TaskType.VISUAL_QA);
  });

  it('routes non-search, non-vision task types to OpenRouter with the general matrix', () => {
    const decision = r.route(task({ type: TaskType.CODE_GENERATION }));
    expect(decision.provider).toBe(Provider.OPENROUTER);
    expect(decision.taskType).toBe(TaskType.CODE_GENERATION);
  });

  it('defaults clientId to "default" when the task has none', () => {
    const decision = r.route({ type: TaskType.CLASSIFICATION, complexity: TaskComplexity.LOW });
    expect(decision.clientId).toBe('default');
  });

  it('assigns a unique taskId and ISO timestamp to every decision', () => {
    const a = r.route(task());
    const b = r.route(task());
    expect(a.taskId).not.toBe(b.taskId);
    expect(() => new Date(a.timestamp).toISOString()).not.toThrow();
  });
});

describe('L9LLMRouter budget + client management delegation', () => {
  it('initClient + getClientBudgetReport round-trip through the BudgetTracker', () => {
    const r = router();
    const report = r.getClientBudgetReport('acme');
    expect(report.throttleLevel).toBe('none');
  });

  it('resetDaily/Weekly/Monthly delegate to the BudgetTracker without throwing', () => {
    const r = router();
    expect(() => r.resetDaily('acme')).not.toThrow();
    expect(() => r.resetWeekly('acme')).not.toThrow();
    expect(() => r.resetMonthly('acme')).not.toThrow();
  });

  it('getAllBudgetReports and getGlobalSpend reflect the initialized client', () => {
    const r = router();
    expect(r.getAllBudgetReports()).toHaveLength(1);
    expect(r.getGlobalSpend().monthSpend).toBe(0);
  });
});

describe('L9LLMRouter call log + vision helpers', () => {
  it('getCallLog/getCallLogByClient start empty before any execute() call', () => {
    const r = router();
    expect(r.getCallLog()).toEqual([]);
    expect(r.getCallLogByClient('acme')).toEqual([]);
  });

  it('planVisualQA delegates to generateFullSiteQAPlan', () => {
    const r = router();
    const plan = r.planVisualQA({
      pages: ['/a'],
      viewports: [r.getViewports().desktop_1920],
      conversionAudit: false,
    });
    expect(plan).toHaveLength(1);
  });

  it('getViewports exposes the standard viewport presets', () => {
    const r = router();
    expect(Object.keys(r.getViewports())).toContain('mobile_iphone');
  });
});

describe('BudgetExhaustedError', () => {
  it('carries the originating task and routing decision', () => {
    const r = router();
    const decision = r.route(task());
    const error = new BudgetExhaustedError('deferred', task(), decision);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('BudgetExhaustedError');
    expect(error.decision).toBe(decision);
  });
});
