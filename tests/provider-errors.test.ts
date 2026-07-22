import { describe, expect, it } from 'vitest';
import { classifyProviderError, isCircuitFailure, ProviderRequestError } from '../src/provider-errors.js';
import { Provider } from '../src/types.js';

describe('provider error classification', () => {
  it('classifies 429 as retryable', () => {
    const error = classifyProviderError({ message: 'slow down', status: 429, headers: { 'retry-after': '2', 'x-request-id': 'req' } }, Provider.OPENROUTER);
    expect(error).toMatchObject({ kind: 'rate_limit', retryable: true, requestId: 'req', retryAfterMs: 2000 });
    expect(isCircuitFailure(error, Provider.OPENROUTER)).toBe(true);
  });

  it('does not count client or local validation failures', () => {
    expect(isCircuitFailure({ message: 'bad input', status: 400 }, Provider.PERPLEXITY)).toBe(false);
    const local = new Error('bad URL'); local.name = 'UnsafeImageUrlError';
    expect(isCircuitFailure(local, Provider.OPENROUTER)).toBe(false);
  });

  it('serializes only allowlisted metadata', () => {
    const error = new ProviderRequestError('failed', { provider: Provider.OPENROUTER, kind: 'server', retryable: true, cause: { apiKey: 'secret' } });
    expect(JSON.stringify(error)).not.toContain('secret');
  });
});
