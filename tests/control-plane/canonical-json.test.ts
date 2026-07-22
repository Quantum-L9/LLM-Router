import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson, CanonicalJsonError, sha256Hex } from '../../src/control-plane/canonical-json.js';

describe('canonical JSON', () => {
  it('matches the cross-language golden vector', () => {
    const vector = JSON.parse(readFileSync('fixtures/control-plane/canonical-golden-v1.json', 'utf8'));
    expect(canonicalJson(vector.input)).toBe(vector.canonical);
    expect(sha256Hex(vector.input)).toBe(vector.sha256);
  });

  it('is independent of insertion order and Unicode composition', () => {
    expect(canonicalJson({ z: 1, a: 'e\u0301' })).toBe(canonicalJson({ a: 'é', z: 1 }));
  });

  it.each([NaN, Infinity, -Infinity, undefined, 1n])('rejects unsupported scalar %s', value => {
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });

  it('rejects cycles, sparse arrays, accessors, and normalization collisions', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow(/cyclic/);
    const sparse = Array(2); sparse[1] = 1;
    expect(() => canonicalJson(sparse)).toThrow(/sparse/);
    const accessor = Object.defineProperty({}, 'x', { enumerable: true, get: () => 1 });
    expect(() => canonicalJson(accessor)).toThrow(/accessors/);
    expect(() => canonicalJson({ 'e\u0301': 1, 'é': 2 })).toThrow(/duplicate key/);
  });
});
