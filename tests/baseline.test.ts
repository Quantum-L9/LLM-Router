import { describe, expect, it } from 'vitest';
import { L9LLMRouter, TaskComplexity, TaskType } from '../src/index.js';
describe('baseline', () => { it('routes a simple task', () => { const router = new L9LLMRouter({ perplexityApiKey: 'p', openrouterApiKey: 'o' }); expect(router.route({type: TaskType.CLASSIFICATION, complexity: TaskComplexity.LOW}).model).toBeTruthy(); }); });
