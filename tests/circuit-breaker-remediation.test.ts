import { describe, expect, it } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../src/circuit-breaker.js';
import { Provider } from '../src/types.js';

describe('circuit breaker remediation', () => {
  it('allows exactly one half-open probe', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, openDurationMs: 100 });
    const start = new Date('2026-01-01T00:00:00.000Z');
    const permit = breaker.acquire(Provider.OPENROUTER, start);
    breaker.recordFailure(permit, start);
    const probe = breaker.acquire(Provider.OPENROUTER, new Date(start.getTime() + 101));
    expect(probe.halfOpenProbe).toBe(true);
    expect(() => breaker.acquire(Provider.OPENROUTER, new Date(start.getTime() + 102))).toThrow(CircuitOpenError);
  });

  it('closes after a successful half-open probe', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, openDurationMs: 1 });
    const now = new Date('2026-01-01T00:00:00Z');
    breaker.recordFailure(breaker.acquire(Provider.PERPLEXITY, now), now);
    const probe = breaker.acquire(Provider.PERPLEXITY, new Date(now.getTime() + 2));
    breaker.recordSuccess(probe);
    expect(breaker.getState(Provider.PERPLEXITY)).toMatchObject({ state: 'closed', failureCount: 0, probeInFlight: false });
  });

  it('reopens immediately after a failed probe', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5, openDurationMs: 1 });
    const now = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 5; i += 1) breaker.recordFailure(breaker.acquire(Provider.OPENROUTER, now), now);
    const probe = breaker.acquire(Provider.OPENROUTER, new Date(now.getTime() + 2));
    breaker.recordFailure(probe, new Date(now.getTime() + 2));
    expect(breaker.getState(Provider.OPENROUTER).state).toBe('open');
  });

  it('does not let a stale success close a circuit opened by a newer failure', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, openDurationMs: 100 });
    const now = new Date('2026-01-01T00:00:00Z');
    const stale = breaker.acquire(Provider.OPENROUTER, now);
    const failing = breaker.acquire(Provider.OPENROUTER, now);
    breaker.recordFailure(failing, now);
    breaker.recordSuccess(stale);
    expect(breaker.getState(Provider.OPENROUTER)).toMatchObject({ state: 'open', failureCount: 1 });
  });

  it('preserves the legacy canProceed probe lifecycle', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, openDurationMs: 10 });
    const now = new Date('2026-01-01T00:00:00Z');
    breaker.recordProviderFailure(Provider.PERPLEXITY, now);
    expect(breaker.canProceed(Provider.PERPLEXITY, new Date(now.getTime() + 11))).toBe(true);
    expect(breaker.canProceed(Provider.PERPLEXITY, new Date(now.getTime() + 12))).toBe(false);
    breaker.recordProviderSuccess(Provider.PERPLEXITY);
    expect(breaker.getState(Provider.PERPLEXITY)).toMatchObject({ state: 'closed', failureCount: 0, probeInFlight: false });
  });

  it('rejects invalid direct configuration', () => {
    expect(() => new CircuitBreaker({ failureThreshold: 0 })).toThrow(/positive integer/);
    expect(() => new CircuitBreaker({ openDurationMs: Number.NaN })).toThrow(/positive integer/);
  });
});
