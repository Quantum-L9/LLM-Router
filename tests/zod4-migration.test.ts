import { describe, expect, it } from 'vitest';
import { parseRouterConfig, parseTaskDescriptor, RouterConfigSchema, TaskDescriptorSchema } from '../src/schemas.js';
import { TaskComplexity, TaskType } from '../src/types.js';

describe('Zod 4 migration compatibility', () => {
  it('preserves legacy unknown-field stripping', () => {
    const parsed = parseTaskDescriptor({ type: TaskType.CLASSIFICATION, complexity: TaskComplexity.LOW, futureField: true });
    expect(parsed).not.toHaveProperty('futureField');
  });

  it('keeps optional legacy fields optional', () => {
    expect(TaskDescriptorSchema.safeParse({ type: TaskType.SCORING, complexity: TaskComplexity.TRIVIAL }).success).toBe(true);
    expect(RouterConfigSchema.safeParse({ perplexityApiKey: 'p', openrouterApiKey: 'o' }).success).toBe(true);
  });

  it('does not widen enum validation', () => {
    expect(TaskDescriptorSchema.safeParse({ type: 'classification-ish', complexity: TaskComplexity.LOW }).success).toBe(false);
  });

  it('keeps validation errors JSON-safe', () => {
    try { parseRouterConfig({ perplexityApiKey: '', openrouterApiKey: '' }); }
    catch (error) { expect(() => JSON.stringify(error)).not.toThrow(); }
  });
});
