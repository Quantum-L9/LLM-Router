import { L9LLMRouter, TaskComplexity, TaskType, type TaskDescriptor } from '../../../dist/index.js';
import { OpenRouterClient } from '../../../dist/providers/openrouter.js';
import { PerplexityClient } from '../../../dist/providers/perplexity.js';
import { VIEWPORTS } from '../../../dist/vision/index.js';

const task: TaskDescriptor = { type: TaskType.CLASSIFICATION, complexity: TaskComplexity.LOW, clientId: 'fixture' };
const router: L9LLMRouter | undefined = undefined;
const openrouter: OpenRouterClient | undefined = undefined;
const perplexity: PerplexityClient | undefined = undefined;
// Reference every imported symbol so the declaration build proves each public
// type and value is consumable from the packaged `dist/` entry points.
export const declarationConsumerProbe = [task, router, openrouter, perplexity, VIEWPORTS] as const;
