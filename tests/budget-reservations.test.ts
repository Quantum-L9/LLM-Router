import { describe, expect, it } from 'vitest';
import { BudgetReservationError, BudgetTracker } from '../src/budget/index.js';
import { TaskComplexity, TaskType } from '../src/types.js';

const lowTask = { type: TaskType.CLASSIFICATION, complexity: TaskComplexity.LOW };

describe('budget reservations', () => {
  it('prevents concurrent reservations from overshooting a ceiling', () => {
    const tracker = new BudgetTracker({ monthlyBudgetPerClient: 1, weeklyTarget: 1, weeklyHardCeiling: 1, globalMonthlyHardCeiling: 1 });
    tracker.initClient('a');
    let sequence = 0;
    const accepted: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      try { accepted.push(tracker.reserveTask('a', lowTask, 0.1, new Date(), () => `r${++sequence}`).reservation.id); }
      catch (error) { expect(error).toBeInstanceOf(BudgetReservationError); }
    }
    expect(accepted.length).toBeLessThanOrEqual(10);
    expect(tracker.getClientBudgetReport('a').reservedSpend).toBeCloseTo(accepted.length * 0.1);
  });

  it('releases an unbilled reservation', () => {
    const tracker = new BudgetTracker();
    tracker.initClient('a');
    const reservation = tracker.reserveTask('a', lowTask, 0.2, new Date(), () => 'r').reservation;
    tracker.release(reservation.id);
    expect(tracker.getClientBudgetReport('a')).toMatchObject({ reservedSpend: 0, activeReservations: 0, monthSpend: 0 });
  });

  it('reconciles estimated and actual cost exactly once', () => {
    const tracker = new BudgetTracker();
    tracker.initClient('a');
    const reservation = tracker.reserveTask('a', lowTask, 0.2, new Date(), () => 'r').reservation;
    tracker.reconcile(reservation.id, 0.15);
    expect(tracker.getClientBudgetReport('a')).toMatchObject({ reservedSpend: 0, activeReservations: 0, monthSpend: 0.15 });
    expect(() => tracker.reconcile(reservation.id, 0.15)).toThrow(/already-settled/);
  });

  it('rejects duplicate reservation identities without leaking reserved spend', () => {
    const tracker = new BudgetTracker();
    tracker.initClient('a');
    tracker.reserveTask('a', lowTask, 0.2, new Date(), () => 'duplicate');
    expect(() => tracker.reserveTask('a', lowTask, 0.2, new Date(), () => 'duplicate')).toThrow(/Duplicate/);
    expect(tracker.getClientBudgetReport('a')).toMatchObject({ reservedSpend: 0.2, activeReservations: 1 });
  });

  it('validates direct tracker configuration and client overrides', () => {
    expect(() => new BudgetTracker({ weeklyTarget: 0 })).toThrow(/weeklyTarget/);
    const tracker = new BudgetTracker();
    expect(() => tracker.initClient('a', { weeklyTarget: 101, weeklyHardCeiling: 100 })).toThrow(/must not exceed/);
    expect(() => tracker.initClient('   ')).toThrow(/clientId/);
  });
});
