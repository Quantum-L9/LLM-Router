import type { CircuitBreakerConfig, CircuitBreakerState, Provider } from './types.js';

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = Object.freeze({
  failureThreshold: 5,
  openDurationMs: 30_000,
});

export interface CircuitPermit {
  readonly provider: Provider;
  readonly halfOpenProbe: boolean;
  readonly acquiredAt: Date;
}

export class CircuitOpenError extends Error {
  constructor(public readonly provider: Provider) {
    super(`Circuit breaker is open for provider "${provider}"; dispatch refused.`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private readonly states = new Map<Provider, CircuitBreakerState>();
  private readonly legacyHalfOpenPermits = new Map<Provider, CircuitPermit>();

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    if (!Number.isInteger(this.config.failureThreshold) || this.config.failureThreshold <= 0) {
      throw new RangeError('failureThreshold must be a positive integer');
    }
    if (!Number.isInteger(this.config.openDurationMs) || this.config.openDurationMs <= 0) {
      throw new RangeError('openDurationMs must be a positive integer');
    }
  }

  acquire(provider: Provider, now: Date = new Date()): CircuitPermit {
    const state = this.getOrInit(provider);
    if (state.state === 'closed') return { provider, halfOpenProbe: false, acquiredAt: now };

    if (state.state === 'open') {
      if (!state.nextRetryAt || now < state.nextRetryAt) throw new CircuitOpenError(provider);
      state.state = 'half-open';
      state.probeInFlight = true;
      return { provider, halfOpenProbe: true, acquiredAt: now };
    }

    if (state.probeInFlight) throw new CircuitOpenError(provider);
    state.probeInFlight = true;
    return { provider, halfOpenProbe: true, acquiredAt: now };
  }

  canProceed(provider: Provider, now: Date = new Date()): boolean {
    try {
      const permit = this.acquire(provider, now);
      if (permit.halfOpenProbe) this.legacyHalfOpenPermits.set(provider, permit);
      return true;
    } catch (error) {
      if (error instanceof CircuitOpenError) return false;
      throw error;
    }
  }

  recordSuccess(permit: CircuitPermit): void {
    const state = this.getOrInit(permit.provider);
    if (!permit.halfOpenProbe && state.state !== 'closed') return;
    state.state = 'closed';
    state.failureCount = 0;
    state.lastFailure = undefined;
    state.nextRetryAt = undefined;
    state.probeInFlight = false;
  }

  recordFailure(permit: CircuitPermit, now: Date = new Date()): void {
    const state = this.getOrInit(permit.provider);
    if (!permit.halfOpenProbe && state.state !== 'closed') return;
    state.failureCount += 1;
    state.lastFailure = now;
    state.probeInFlight = false;
    if (permit.halfOpenProbe || state.failureCount >= this.config.failureThreshold) {
      state.state = 'open';
      state.nextRetryAt = new Date(now.getTime() + this.config.openDurationMs);
    }
  }

  /** Releases a permit after a non-provider failure or cancellation. */
  release(permit: CircuitPermit, now: Date = new Date()): void {
    if (!permit.halfOpenProbe) return;
    const state = this.getOrInit(permit.provider);
    state.probeInFlight = false;
    state.state = 'open';
    state.nextRetryAt = new Date(now.getTime() + this.config.openDurationMs);
  }

  /** Backward-compatible direct success API. */
  recordProviderSuccess(provider: Provider): void {
    const permit = this.legacyHalfOpenPermits.get(provider) ?? { provider, halfOpenProbe: false, acquiredAt: new Date() };
    this.legacyHalfOpenPermits.delete(provider);
    this.recordSuccess(permit);
  }

  /** Backward-compatible direct failure API. */
  recordProviderFailure(provider: Provider, now: Date = new Date()): void {
    const permit = this.legacyHalfOpenPermits.get(provider) ?? { provider, halfOpenProbe: false, acquiredAt: now };
    this.legacyHalfOpenPermits.delete(provider);
    this.recordFailure(permit, now);
  }

  getState(provider: Provider): CircuitBreakerState {
    return cloneState(this.getOrInit(provider));
  }

  getAllStates(): CircuitBreakerState[] {
    return Array.from(this.states.values(), cloneState);
  }

  private getOrInit(provider: Provider): CircuitBreakerState {
    let state = this.states.get(provider);
    if (!state) {
      state = { provider, state: 'closed', failureCount: 0, probeInFlight: false };
      this.states.set(provider, state);
    }
    return state;
  }
}

function cloneState(state: CircuitBreakerState): CircuitBreakerState {
  return {
    ...state,
    lastFailure: state.lastFailure ? new Date(state.lastFailure) : undefined,
    nextRetryAt: state.nextRetryAt ? new Date(state.nextRetryAt) : undefined,
  };
}
