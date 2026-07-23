import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
}

describe('Vitest discovery contract', () => {
  it('discovers all TypeScript test files under tests/', () => {
    const files = walk('tests').filter(file => file.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.every(file => file.startsWith('tests'))).toBe(true);
  });
});
