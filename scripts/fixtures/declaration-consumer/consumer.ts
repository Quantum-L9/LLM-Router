import {
  L9LLMRouter,
  SearchPolicySource,
  TaskComplexity,
  TaskType,
  UnsupportedCapabilityCombinationError,
  resolveSearchPolicy,
  type RoutingDecision,
  type SearchPolicyResolution,
  type TaskDescriptor,
} from '../../../dist/index.js';
import { OpenRouterClient } from '../../../dist/providers/openrouter.js';
import { PerplexityClient } from '../../../dist/providers/perplexity.js';
import { VIEWPORTS } from '../../../dist/vision/index.js';

const task: TaskDescriptor = { type: TaskType.CLASSIFICATION, complexity: TaskComplexity.LOW, clientId: 'fixture' };
// Capability declaration is the application's; provider and model are not.
const strategicWithoutSearch: TaskDescriptor = { type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.HIGH, requiresSearch: false, clientId: 'fixture' };
const freshWebWithSearch: TaskDescriptor = { type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.HIGH, requiresSearch: true, clientId: 'fixture' };
const policy: SearchPolicyResolution = resolveSearchPolicy(strategicWithoutSearch);
const policySource: SearchPolicySource = policy.source;
const decision: RoutingDecision | undefined = undefined;
const conflict: UnsupportedCapabilityCombinationError | undefined = undefined;
const router: L9LLMRouter | undefined = undefined;
const openrouter: OpenRouterClient | undefined = undefined;
const perplexity: PerplexityClient | undefined = undefined;
// Reference every imported symbol so the declaration build proves each public
// type and value is consumable from the packaged `dist/` entry points.
export const declarationConsumerProbe = [
  task, strategicWithoutSearch, freshWebWithSearch, policy, policySource, decision, conflict,
  router, openrouter, perplexity, VIEWPORTS,
] as const;
