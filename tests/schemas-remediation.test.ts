import { describe, expect, it } from 'vitest';
import { parseRouterConfig, parseTaskDescriptor, RouterConfigValidationError, TaskValidationError } from '../src/schemas.js';
import { TaskComplexity, TaskType } from '../src/types.js';

describe('legacy runtime schemas', () => {
  it('parses valid task input', () => expect(parseTaskDescriptor({ type: TaskType.EXTRACTION, complexity: TaskComplexity.LOW })).toMatchObject({ type: TaskType.EXTRACTION }));
  it('rejects malformed task input before routing', () => expect(() => parseTaskDescriptor({ type: 'bad', complexity: 'bad' })).toThrow(TaskValidationError));
  it('requires both API keys', () => expect(() => parseRouterConfig({ openrouterApiKey: 'x' })).toThrow(RouterConfigValidationError));
  it('forces provider retries to remain explicit', () => expect(() => parseRouterConfig({ openrouterApiKey: 'x', perplexityApiKey: 'y', providerMaxRetries: 1 })).toThrow(/must remain 0/));
});
