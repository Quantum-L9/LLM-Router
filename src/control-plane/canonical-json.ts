import { createHash } from 'node:crypto';

export class CanonicalJsonError extends TypeError {
  constructor(message: string) { super(message); this.name = 'CanonicalJsonError'; }
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalize(value: unknown, stack: Set<object>, path: string): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return typeof value === 'string' ? value.normalize('NFC') : value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalJsonError(`${path}: non-finite numbers are forbidden`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (['undefined', 'bigint', 'symbol', 'function'].includes(typeof value)) throw new CanonicalJsonError(`${path}: unsupported ${typeof value} value`);
  if (typeof value !== 'object') throw new CanonicalJsonError(`${path}: unsupported value`);
  if (stack.has(value)) throw new CanonicalJsonError(`${path}: cyclic value`);
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) if (!(index in value)) throw new CanonicalJsonError(`${path}[${index}]: sparse arrays are forbidden`);
      return value.map((entry, index) => normalize(entry, stack, `${path}[${index}]`));
    }
    if (!isPlainObject(value)) throw new CanonicalJsonError(`${path}: only plain objects are canonicalizable`);
    if (Object.getOwnPropertySymbols(value).length > 0) throw new CanonicalJsonError(`${path}: symbol properties are forbidden`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const normalizedEntries = Object.keys(descriptors).map(key => {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new CanonicalJsonError(`${path}.${key}: accessors and non-enumerable properties are forbidden`);
      return { originalKey: key, key: key.normalize('NFC'), value: descriptor.value };
    });
    const seen = new Set<string>();
    for (const entry of normalizedEntries) {
      if (seen.has(entry.key)) throw new CanonicalJsonError(`${path}: Unicode-normalized duplicate key "${entry.key}"`);
      seen.add(entry.key);
    }
    normalizedEntries.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
    const result: Record<string, unknown> = {};
    for (const entry of normalizedEntries) result[entry.key] = normalize(entry.value, stack, `${path}.${entry.originalKey}`);
    return result;
  } finally {
    stack.delete(value);
  }
}

export function canonicalize(value: unknown): unknown { return normalize(value, new Set(), '$'); }
export function canonicalJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }
export function sha256Hex(value: unknown): string { return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex'); }
