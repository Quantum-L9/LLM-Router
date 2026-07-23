# @quantum-l9/llm-router

Shared deterministic model routing, budget enforcement, provider resilience, and visual QA for L9 bots.

```ts
import { L9LLMRouter, TaskComplexity, TaskType } from '@quantum-l9/llm-router';

const router = new L9LLMRouter({
  perplexityApiKey: process.env.PERPLEXITY_API_KEY!,
  openrouterApiKey: process.env.OPENROUTER_API_KEY!,
});
router.initClient('tenant-a', { monthlyBudgetPerClient: 200 });
const result = await router.execute(
  { clientId: 'tenant-a', type: TaskType.CONTENT_GENERATION, complexity: TaskComplexity.MEDIUM },
  'You are a careful writer.',
  'Draft the article.',
);
```

Direct imports from `./openrouter` or `./perplexity` are retained for 1.x compatibility but are deprecated. They bypass router-level budget and circuit controls.
