import { randomUUID } from 'node:crypto';
import {
  TaskComplexity,
  type BudgetConfig,
  type BudgetReservation,
  type BudgetState,
  type TaskDescriptor,
} from '../types.js';

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = Object.freeze({
  monthlyBudgetPerClient: 200,
  weeklyTarget: 50,
  weeklyHardCeiling: 100,
  globalMonthlyHardCeiling: 2_000,
  surgeThreshold: 0.6,
});

export enum ThrottleLevel { NONE = 'none', SOFT = 'soft', HARD = 'hard' }

export interface ThrottleDecision {
  level: ThrottleLevel;
  reason: string;
  allowTask: boolean;
  forceDowngrade: boolean;
  maxModelTier: 'fast' | 'strategic' | 'critical';
}

interface ClientRecord {
  state: BudgetState;
  config: BudgetConfig;
}

export class BudgetTracker {
  private readonly config: BudgetConfig;
  private readonly clients = new Map<string, ClientRecord>();
  private readonly reservations = new Map<string, BudgetReservation>();
  private globalMonthSpend = 0;
  private globalReservedSpend = 0;

  constructor(config: Partial<BudgetConfig> = {}) {
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
    validateBudgetConfig(this.config);
  }

  initClient(clientId: string, overrides?: Partial<BudgetConfig>): void {
    if (clientId.trim().length === 0) throw new RangeError('clientId must not be empty');
    const clientConfig = { ...this.config, ...overrides };
    validateBudgetConfig(clientConfig);
    this.clients.set(clientId, {
      config: clientConfig,
      state: {
        clientId,
        monthlyBudget: clientConfig.monthlyBudgetPerClient,
        monthSpend: 0,
        weekSpend: 0,
        weekTarget: clientConfig.weeklyTarget,
        todaySpend: 0,
        weeklyHardCeiling: clientConfig.weeklyHardCeiling,
        surgeAllowance: false,
        remainingMonthly: clientConfig.monthlyBudgetPerClient,
        remainingWeekly: clientConfig.weeklyHardCeiling,
        throttleLevel: 'none',
        reservedSpend: 0,
        activeReservations: 0,
      },
    });
  }

  evaluateTask(clientId: string, task: TaskDescriptor, estimatedCost: number): ThrottleDecision {
    const record = this.getRecord(clientId);
    const level = this.computeThrottleLevel(record, estimatedCost);
    if (task.complexity === TaskComplexity.CRITICAL) {
      return { level: ThrottleLevel.NONE, reason: 'Critical task; budget override engaged', allowTask: true, forceDowngrade: false, maxModelTier: 'critical' };
    }
    if (level === ThrottleLevel.HARD) {
      if (task.complexity === TaskComplexity.HIGH) return { level, reason: 'Hard throttle; high task downgraded', allowTask: true, forceDowngrade: true, maxModelTier: 'strategic' };
      if (task.complexity === TaskComplexity.MEDIUM || estimatedCost < 0.005) return { level, reason: 'Hard throttle; task forced to fast tier', allowTask: true, forceDowngrade: true, maxModelTier: 'fast' };
      return { level, reason: 'Hard throttle; low-value task deferred', allowTask: false, forceDowngrade: false, maxModelTier: 'fast' };
    }
    if (level === ThrottleLevel.SOFT) {
      return { level, reason: 'Soft throttle; cheaper tier required', allowTask: true, forceDowngrade: true, maxModelTier: task.complexity === TaskComplexity.HIGH ? 'strategic' : 'fast' };
    }
    return { level, reason: 'Within budget', allowTask: true, forceDowngrade: false, maxModelTier: 'critical' };
  }

  reserveTask(
    clientId: string,
    task: TaskDescriptor,
    estimatedCost: number,
    now: Date = new Date(),
    idFactory: () => string = randomUUID,
  ): { decision: ThrottleDecision; reservation: BudgetReservation } {
    if (!Number.isFinite(estimatedCost) || estimatedCost < 0) throw new RangeError('estimatedCost must be a finite non-negative number');
    const decision = this.evaluateTask(clientId, task, estimatedCost);
    if (!decision.allowTask) throw new BudgetReservationError(decision.reason);
    const record = this.getRecord(clientId);
    const reservation: BudgetReservation = { id: idFactory(), clientId, estimatedCost, createdAt: now.toISOString() };
    if (reservation.id.length === 0) throw new BudgetReservationError('Budget reservation ID must not be empty');
    if (this.reservations.has(reservation.id)) throw new BudgetReservationError(`Duplicate budget reservation ID: ${reservation.id}`);
    this.reservations.set(reservation.id, reservation);
    record.state.reservedSpend += estimatedCost;
    record.state.activeReservations += 1;
    this.globalReservedSpend += estimatedCost;
    this.refreshDerived(record);
    return { decision, reservation };
  }

  reconcile(reservationId: string, actualCost: number): void {
    if (!Number.isFinite(actualCost) || actualCost < 0) throw new RangeError('actualCost must be a finite non-negative number');
    const reservation = this.takeReservation(reservationId);
    const record = this.getRecord(reservation.clientId);
    this.releaseReservationAmounts(record, reservation);
    this.commitSpend(record, actualCost);
  }

  release(reservationId: string): void {
    const reservation = this.takeReservation(reservationId);
    const record = this.getRecord(reservation.clientId);
    this.releaseReservationAmounts(record, reservation);
    this.refreshDerived(record);
  }

  recordSpend(clientId: string, amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError('amount must be a finite non-negative number');
    this.commitSpend(this.getRecord(clientId), amount);
  }

  resetDaily(clientId: string): void { this.getRecord(clientId).state.todaySpend = 0; }
  resetWeekly(clientId: string): void {
    const record = this.getRecord(clientId);
    record.state.weekSpend = 0;
    record.state.surgeAllowance = false;
    this.refreshDerived(record);
  }
  resetMonthly(clientId: string): void {
    const record = this.getRecord(clientId);
    record.state.monthSpend = 0;
    record.state.weekSpend = 0;
    record.state.todaySpend = 0;
    record.state.surgeAllowance = false;
    this.refreshDerived(record);
  }
  resetGlobalMonthly(): void { this.globalMonthSpend = 0; }

  checkSurgeAllowance(clientId: string, dayOfWeek: number): boolean {
    const record = this.getRecord(clientId);
    if (dayOfWeek >= 4 && record.state.weekSpend / record.state.weekTarget < record.config.surgeThreshold) record.state.surgeAllowance = true;
    return record.state.surgeAllowance;
  }

  getClientBudgetReport(clientId: string): BudgetState { return { ...this.getRecord(clientId).state }; }
  getAllBudgetReports(): BudgetState[] { return Array.from(this.clients.values(), entry => ({ ...entry.state })); }
  getGlobalSpend(): { monthSpend: number; reservedSpend: number; ceiling: number; utilization: number } {
    return {
      monthSpend: this.globalMonthSpend,
      reservedSpend: this.globalReservedSpend,
      ceiling: this.config.globalMonthlyHardCeiling,
      utilization: (this.globalMonthSpend + this.globalReservedSpend) / this.config.globalMonthlyHardCeiling,
    };
  }

  private computeThrottleLevel(record: ClientRecord, pendingCost: number): ThrottleLevel {
    const state = record.state;
    const projectedMonth = state.monthSpend + state.reservedSpend + pendingCost;
    const projectedWeek = state.weekSpend + state.reservedSpend + pendingCost;
    const projectedGlobal = this.globalMonthSpend + this.globalReservedSpend + pendingCost;
    if (projectedMonth > state.monthlyBudget || projectedGlobal > this.config.globalMonthlyHardCeiling || (projectedWeek > state.weeklyHardCeiling && !state.surgeAllowance)) return ThrottleLevel.HARD;
    if (projectedWeek > state.weekTarget || projectedMonth > state.monthlyBudget * 0.8) return ThrottleLevel.SOFT;
    return ThrottleLevel.NONE;
  }

  private getRecord(clientId: string): ClientRecord {
    const record = this.clients.get(clientId);
    if (!record) throw new Error(`Client ${clientId} not initialized. Call initClient() first.`);
    return record;
  }

  private takeReservation(id: string): BudgetReservation {
    const reservation = this.reservations.get(id);
    if (!reservation) throw new Error(`Unknown or already-settled budget reservation: ${id}`);
    this.reservations.delete(id);
    return reservation;
  }

  private releaseReservationAmounts(record: ClientRecord, reservation: BudgetReservation): void {
    record.state.reservedSpend = Math.max(0, record.state.reservedSpend - reservation.estimatedCost);
    record.state.activeReservations = Math.max(0, record.state.activeReservations - 1);
    this.globalReservedSpend = Math.max(0, this.globalReservedSpend - reservation.estimatedCost);
  }

  private commitSpend(record: ClientRecord, amount: number): void {
    record.state.monthSpend += amount;
    record.state.weekSpend += amount;
    record.state.todaySpend += amount;
    this.globalMonthSpend += amount;
    this.refreshDerived(record);
  }

  private refreshDerived(record: ClientRecord): void {
    const state = record.state;
    state.remainingMonthly = state.monthlyBudget - state.monthSpend - state.reservedSpend;
    state.remainingWeekly = state.weeklyHardCeiling - state.weekSpend - state.reservedSpend;
    state.throttleLevel = this.computeThrottleLevel(record, 0);
  }
}

export class BudgetReservationError extends Error {
  constructor(message: string) { super(message); this.name = 'BudgetReservationError'; }
}

function validateBudgetConfig(config: BudgetConfig): void {
  const positiveFields: Array<keyof Omit<BudgetConfig, 'surgeThreshold'>> = [
    'monthlyBudgetPerClient',
    'weeklyTarget',
    'weeklyHardCeiling',
    'globalMonthlyHardCeiling',
  ];
  for (const field of positiveFields) {
    if (!Number.isFinite(config[field]) || config[field] <= 0) throw new RangeError(`${field} must be a finite positive number`);
  }
  if (!Number.isFinite(config.surgeThreshold) || config.surgeThreshold < 0 || config.surgeThreshold > 1) {
    throw new RangeError('surgeThreshold must be between 0 and 1');
  }
  if (config.weeklyTarget > config.weeklyHardCeiling) {
    throw new RangeError('weeklyTarget must not exceed weeklyHardCeiling');
  }
}
