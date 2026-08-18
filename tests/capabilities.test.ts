import { describe, expect, it } from 'vitest';
import { resolveCapabilities, VISION_TASKS } from '../src/matrices/capabilities.js';
import { SearchPolicySource, TaskType, type TaskDescriptor } from '../src/types.js';

function task(overrides: Partial<TaskDescriptor> = {}): TaskDescriptor {
  return { type: TaskType.STRATEGIC_REASONING, complexity: 'fast', ...overrides };
}

describe('resolveCapabilities', () => {
  it('derives search truth from the explicit flag and reports the EXPLICIT source', () => {
    expect(resolveCapabilities(task({ requiresSearch: true }))).toEqual({
      searchRequired: true,
      searchPolicySource: SearchPolicySource.EXPLICIT,
      visionRequired: false,
    });
    expect(resolveCapabilities(task({ requiresSearch: false }))).toEqual({
      searchRequired: false,
      searchPolicySource: SearchPolicySource.EXPLICIT,
      visionRequired: false,
    });
  });

  it('falls back to the TaskType default and reports TASK_DEFAULT when the flag is undefined', () => {
    expect(resolveCapabilities(task({ type: TaskType.MARKET_RESEARCH }))).toEqual({
      searchRequired: true,
      searchPolicySource: SearchPolicySource.TASK_DEFAULT,
      visionRequired: false,
    });
    expect(resolveCapabilities(task({ type: TaskType.CONTENT_GENERATION }))).toEqual({
      searchRequired: false,
      searchPolicySource: SearchPolicySource.TASK_DEFAULT,
      visionRequired: false,
    });
  });

  it('marks exactly the vision task types as vision-required', () => {
    for (const type of VISION_TASKS) {
      expect(resolveCapabilities(task({ type })).visionRequired).toBe(true);
    }
    expect(resolveCapabilities(task({ type: TaskType.STRATEGIC_REASONING })).visionRequired).toBe(false);
  });

  it('does not conflate a vision task with a search requirement', () => {
    const resolved = resolveCapabilities(task({ type: TaskType.SCREENSHOT_ANALYSIS, requiresSearch: false }));
    expect(resolved.visionRequired).toBe(true);
    expect(resolved.searchRequired).toBe(false);
    expect(resolved.searchPolicySource).toBe(SearchPolicySource.EXPLICIT);
  });
});
