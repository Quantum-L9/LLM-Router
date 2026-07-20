import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetTracker, ThrottleLevel } from '../src/budget/index.js';
import { TaskComplexity, TaskType } from '../src/types.js';

function task(complexity: TaskComplexity, type: TaskType = TaskType.CONTENT_GENERATION) {
  return { type, complexity, clientId: 'acme' };
}

describe('BudgetTracker', () => {
  let tracker: BudgetTracker;

  beforeEach(() => {
    tracker = new BudgetTracker();
    tracker.initClient('acme');
  });

  it('throws when querying a client that was never initialized', () => {
    expect(() => tracker.getClientBudgetReport('ghost')).toThrow(
      /not initialized/,
    );
  });

  it('starts with no throttle and full remaining budget', () => {
    const report = tracker.getClientBudgetReport('acme');
    expect(report.throttleLevel).toBe('none');
    expect(report.remainingMonthly).toBe(200);
    expect(report.remainingWeekly).toBe(100);
  });

  it('always allows CRITICAL tasks regardless of spend', () => {
    tracker.recordSpend('acme', 500); // blow way past every ceiling
    const decision = tracker.evaluateTask('acme', task(TaskComplexity.CRITICAL), 10);
    expect(decision.allowTask).toBe(true);
    expect(decision.level).toBe(ThrottleLevel.NONE);
    expect(decision.forceDowngrade).toBe(false);
  });

  it('soft-throttles once weekly target is exceeded', () => {
    tracker.recordSpend('acme', 55); // > weeklyTarget (50), < weeklyHardCeiling (100)
    const report = tracker.getClientBudgetReport('acme');
    expect(report.throttleLevel).toBe('soft');

    const decision = tracker.evaluateTask('acme', task(TaskComplexity.MEDIUM), 1);
    expect(decision.level).toBe(ThrottleLevel.SOFT);
    expect(decision.allowTask).toBe(true);
    expect(decision.forceDowngrade).toBe(true);
    expect(decision.maxModelTier).toBe('strategic');
  });

  it('hard-throttles once the weekly hard ceiling is hit and downgrades MEDIUM to fast tier', () => {
    tracker.recordSpend('acme', 100); // == weeklyHardCeiling
    const report = tracker.getClientBudgetReport('acme');
    expect(report.throttleLevel).toBe('hard');

    const decision = tracker.evaluateTask('acme', task(TaskComplexity.MEDIUM), 1);
    expect(decision.level).toBe(ThrottleLevel.HARD);
    expect(decision.forceDowngrade).toBe(true);
    expect(decision.maxModelTier).toBe('fast');
  });

  it('defers LOW/TRIVIAL tasks under hard throttle unless the cost is negligible', () => {
    tracker.recordSpend('acme', 100);

    const deferred = tracker.evaluateTask('acme', task(TaskComplexity.LOW), 1);
    expect(deferred.allowTask).toBe(false);

    const negligible = tracker.evaluateTask('acme', task(TaskComplexity.LOW), 0.001);
    expect(negligible.allowTask).toBe(true);
    expect(negligible.forceDowngrade).toBe(true);
  });

  it('hard-throttles once the monthly budget is exhausted', () => {
    tracker.recordSpend('acme', 200); // == monthlyBudgetPerClient
    const report = tracker.getClientBudgetReport('acme');
    expect(report.throttleLevel).toBe('hard');
    expect(report.remainingMonthly).toBe(0);
  });

  it('hard-throttles once the global monthly ceiling is hit even for a fresh client', () => {
    tracker.initClient('globex');
    tracker.recordSpend('acme', 1900); // just under global ceiling by itself
    tracker.recordSpend('globex', 150); // pushes global spend over 2000

    const report = tracker.getClientBudgetReport('globex');
    expect(report.throttleLevel).toBe('hard');
  });

  it('resetWeekly clears weekly spend, surge allowance, and throttle', () => {
    tracker.recordSpend('acme', 100);
    tracker.resetWeekly('acme');
    const report = tracker.getClientBudgetReport('acme');
    expect(report.weekSpend).toBe(0);
    expect(report.surgeAllowance).toBe(false);
    expect(report.throttleLevel).toBe('none');
    expect(report.remainingWeekly).toBe(100);
  });

  it('resetMonthly clears all counters back to the full budget', () => {
    tracker.recordSpend('acme', 150);
    tracker.resetMonthly('acme');
    const report = tracker.getClientBudgetReport('acme');
    expect(report.monthSpend).toBe(0);
    expect(report.weekSpend).toBe(0);
    expect(report.todaySpend).toBe(0);
    expect(report.remainingMonthly).toBe(200);
  });

  it('resetDaily only clears todaySpend, leaving week/month spend intact', () => {
    tracker.recordSpend('acme', 10);
    tracker.resetDaily('acme');
    const report = tracker.getClientBudgetReport('acme');
    expect(report.todaySpend).toBe(0);
    expect(report.weekSpend).toBe(10);
    expect(report.monthSpend).toBe(10);
  });

  it('checkSurgeAllowance grants surge on/after Thursday when under the surge threshold', () => {
    tracker.recordSpend('acme', 10); // 10 / 50 target = 0.2, well under 0.6 threshold
    expect(tracker.checkSurgeAllowance('acme', 4)).toBe(true); // Thursday
    // Once granted, surgeAllowance stays true even if asked again on a later day.
    expect(tracker.checkSurgeAllowance('acme', 5)).toBe(true);
  });

  it('checkSurgeAllowance withholds surge before Thursday or above the threshold', () => {
    expect(tracker.checkSurgeAllowance('acme', 2)).toBe(false); // Tuesday
    tracker.recordSpend('acme', 40); // 40 / 50 = 0.8, above 0.6 threshold
    expect(tracker.checkSurgeAllowance('acme', 4)).toBe(false);
  });

  it('getAllBudgetReports and getGlobalSpend reflect recorded spend across clients', () => {
    tracker.initClient('globex');
    tracker.recordSpend('acme', 20);
    tracker.recordSpend('globex', 5);

    const all = tracker.getAllBudgetReports();
    expect(all).toHaveLength(2);

    const global = tracker.getGlobalSpend();
    expect(global.monthSpend).toBe(25);
    expect(global.ceiling).toBe(2000);
    expect(global.utilization).toBeCloseTo(25 / 2000);
  });

  it('per-client overrides in initClient take precedence over the shared config', () => {
    tracker.initClient('tiny', { monthlyBudgetPerClient: 10, weeklyHardCeiling: 5 });
    const report = tracker.getClientBudgetReport('tiny');
    expect(report.monthlyBudget).toBe(10);
    expect(report.weeklyHardCeiling).toBe(5);
  });
});
