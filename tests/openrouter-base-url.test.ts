import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPENROUTER_BASE_URL,
  InvalidBaseUrlError,
  resolveOpenRouterBaseUrl,
} from '../src/providers/openrouter.js';
import { parseRouterConfig, RouterConfigValidationError } from '../src/schemas.js';

const emptyEnv: NodeJS.ProcessEnv = {};

describe('resolveOpenRouterBaseUrl', () => {
  it('returns the OpenRouter cloud default when nothing is configured', () => {
    expect(resolveOpenRouterBaseUrl(undefined, emptyEnv)).toBe(DEFAULT_OPENROUTER_BASE_URL);
    expect(DEFAULT_OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
  });

  it('uses an explicit config value when provided', () => {
    expect(resolveOpenRouterBaseUrl('https://gateway.example.com/v1', emptyEnv)).toBe('https://gateway.example.com/v1');
  });

  it('falls back to OPENROUTER_BASE_URL from the environment', () => {
    const env: NodeJS.ProcessEnv = { OPENROUTER_BASE_URL: 'https://proxy.internal.example/v1' };
    expect(resolveOpenRouterBaseUrl(undefined, env)).toBe('https://proxy.internal.example/v1');
  });

  it('gives explicit config precedence over the environment variable', () => {
    const env: NodeJS.ProcessEnv = { OPENROUTER_BASE_URL: 'https://env.example.com/v1' };
    expect(resolveOpenRouterBaseUrl('https://config.example.com/v1', env)).toBe('https://config.example.com/v1');
  });

  it('ignores a blank environment variable and returns the default', () => {
    const env: NodeJS.ProcessEnv = { OPENROUTER_BASE_URL: '   ' };
    expect(resolveOpenRouterBaseUrl(undefined, env)).toBe(DEFAULT_OPENROUTER_BASE_URL);
  });

  it('normalizes trailing slashes so path joining stays predictable', () => {
    expect(resolveOpenRouterBaseUrl('https://gateway.example.com/v1/', emptyEnv)).toBe('https://gateway.example.com/v1');
    expect(resolveOpenRouterBaseUrl('https://gateway.example.com/v1///', emptyEnv)).toBe('https://gateway.example.com/v1');
  });

  it('accepts http endpoints for local development backends', () => {
    expect(resolveOpenRouterBaseUrl('http://127.0.0.1:8815/v1', emptyEnv)).toBe('http://127.0.0.1:8815/v1');
  });

  it('rejects a config value that is not an absolute URL', () => {
    expect(() => resolveOpenRouterBaseUrl('not-a-url', emptyEnv)).toThrowError(InvalidBaseUrlError);
    try {
      resolveOpenRouterBaseUrl('not-a-url', emptyEnv);
    } catch (error) {
      expect((error as InvalidBaseUrlError).source).toBe('config');
    }
  });

  it('rejects an env value with a non-http protocol and attributes it to env', () => {
    const env: NodeJS.ProcessEnv = { OPENROUTER_BASE_URL: 'ftp://example.com/v1' };
    expect(() => resolveOpenRouterBaseUrl(undefined, env)).toThrowError(InvalidBaseUrlError);
    try {
      resolveOpenRouterBaseUrl(undefined, env);
    } catch (error) {
      expect((error as InvalidBaseUrlError).source).toBe('env');
    }
  });
});

describe('RouterConfig openrouterBaseUrl validation', () => {
  const base = { perplexityApiKey: 'p-key', openrouterApiKey: 'o-key' };

  it('accepts a config without openrouterBaseUrl (backwards compatible)', () => {
    const parsed = parseRouterConfig(base);
    expect(parsed.openrouterBaseUrl).toBeUndefined();
  });

  it('accepts a valid https openrouterBaseUrl', () => {
    const parsed = parseRouterConfig({ ...base, openrouterBaseUrl: 'https://gateway.example.com/v1' });
    expect(parsed.openrouterBaseUrl).toBe('https://gateway.example.com/v1');
  });

  it('rejects a malformed openrouterBaseUrl at config parse time', () => {
    expect(() => parseRouterConfig({ ...base, openrouterBaseUrl: 'not a url' })).toThrowError(RouterConfigValidationError);
  });
});

