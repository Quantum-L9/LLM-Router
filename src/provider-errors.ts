import type { Provider, ProviderErrorMetadata, ProviderFailureKind } from './types.js';

const LOCAL_ERROR_NAMES = new Set([
  'TaskValidationError',
  'RouterConfigValidationError',
  'UnsafeImageUrlError',
  'BudgetExhaustedError',
  'CircuitOpenError',
  'AbortError',
]);

export class ProviderRequestError extends Error {
  public readonly provider: Provider;
  public readonly kind: ProviderFailureKind;
  public readonly retryable: boolean;
  public readonly status?: number;
  public readonly code?: string;
  public readonly requestId?: string;
  public readonly retryAfterMs?: number;
  public override readonly cause?: unknown;

  constructor(message: string, metadata: ProviderErrorMetadata) {
    super(message, { cause: metadata.cause });
    this.name = 'ProviderRequestError';
    this.provider = metadata.provider;
    this.kind = metadata.kind;
    this.retryable = metadata.retryable;
    this.status = metadata.status;
    this.code = metadata.code;
    this.requestId = metadata.requestId;
    this.retryAfterMs = metadata.retryAfterMs;
    this.cause = metadata.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      provider: this.provider,
      kind: this.kind,
      retryable: this.retryable,
      status: this.status,
      code: this.code,
      requestId: this.requestId,
      retryAfterMs: this.retryAfterMs,
    };
  }
}

function numberField(value: unknown, key: string): number | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
}

function stringField(value: unknown, ...keys: string[]): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

function headerValue(error: unknown, name: string): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const headers = (error as Record<string, unknown>).headers;
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get: (headerName: string) => string | null }).get(name);
    return value ?? undefined;
  }
  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === name.toLowerCase() && typeof value === 'string') return value;
    }
  }
  return undefined;
}

function retryAfterMs(error: unknown): number | undefined {
  const raw = headerValue(error, 'retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export function classifyProviderError(error: unknown, provider: Provider): ProviderRequestError {
  if (error instanceof ProviderRequestError) return error;
  const name = error instanceof Error ? error.name : stringField(error, 'name');
  const message = error instanceof Error ? error.message : String(error);
  const status = numberField(error, 'status') ?? numberField(error, 'statusCode');
  const code = stringField(error, 'code', 'type');
  const requestId = stringField(error, 'request_id', 'requestId') ?? headerValue(error, 'x-request-id');

  let kind: ProviderFailureKind = 'unknown';
  let retryable = false;

  if (name && LOCAL_ERROR_NAMES.has(name)) {
    kind = name === 'AbortError' ? 'cancelled' : 'local';
  } else if (status === 429) {
    kind = 'rate_limit';
    retryable = true;
  } else if (status !== undefined && status >= 500) {
    kind = 'server';
    retryable = true;
  } else if (status !== undefined && status >= 400) {
    kind = 'client';
  } else if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || name === 'TimeoutError') {
    kind = 'timeout';
    retryable = true;
  } else if (code && ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) {
    kind = 'network';
    retryable = true;
  } else if (/timeout/i.test(message)) {
    kind = 'timeout';
    retryable = true;
  } else if (/network|socket|connection/i.test(message)) {
    kind = 'network';
    retryable = true;
  }

  return new ProviderRequestError(message, {
    provider,
    kind,
    retryable,
    status,
    code,
    requestId,
    retryAfterMs: retryAfterMs(error),
    cause: error,
  });
}

export function isCircuitFailure(error: unknown, provider: Provider): boolean {
  const classified = classifyProviderError(error, provider);
  return classified.retryable && ['network', 'timeout', 'rate_limit', 'server'].includes(classified.kind);
}

export function throwIfAborted(signal: AbortSignal | undefined, provider: Provider): void {
  if (!signal?.aborted) return;
  throw new ProviderRequestError('Provider request was cancelled', {
    provider,
    kind: 'cancelled',
    retryable: false,
    code: 'ABORTED',
    cause: signal.reason,
  });
}
