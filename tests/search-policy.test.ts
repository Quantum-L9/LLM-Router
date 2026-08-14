import { describe, expect, it } from 'vitest';
import { Provider, TaskComplexity, TaskType, type TaskDescriptor } from '../src/types.js';
import { isSearchTask, requiresSearchProvider, resolveRoute } from '../src/index.js';

const base = (over: Partial<TaskDescriptor>): TaskDescriptor => ({
  type: TaskType.MARKET_RESEARCH,
  complexity: TaskComplexity.HIGH,
  clientId: 'client',
  ...over,
});

describe('search policy — explicit capability wins', () => {
  it('keeps the legacy per-TaskType default when requiresSearch is undefined', () => {
    expect(isSearchTask(TaskType.MARKET_RESEARCH)).toBe(true);
    expect(isSearchTask(TaskType.CONTENT_GENERATION)).toBe(false);
    expect(requiresSearchProvider(base({ requiresSearch: undefined }))).toBe(true);
  });

  it('routes a search TaskType without an explicit flag through the search provider', () => {
    const decision = resolveRoute(base({ type: TaskType.MARKET_RESEARCH }));
    expect(decision.provider).toBe(Provider.PERPLEXITY);
  });

  it('routes a search TaskType with requiresSearch=true through the search provider', () => {
    expect(requiresSearchProvider(base({ requiresSearch: true }))).toBe(true);
    const decision = resolveRoute(base({ type: TaskType.MARKET_RESEARCH, requiresSearch: true }));
    expect(decision.provider).toBe(Provider.PERPLEXITY);
  });

  it('routes a search TaskType with requiresSearch=false through the general reasoning provider', () => {
    expect(requiresSearchProvider(base({ requiresSearch: false }))).toBe(false);
    const decision = resolveRoute(base({ type: TaskType.MARKET_RESEARCH, requiresSearch: false }));
    expect(decision.provider).toBe(Provider.OPENROUTER);
  });

  it('routes CONTENT_GENERATION with requiresSearch=false through the general reasoning provider', () => {
    const decision = resolveRoute(
      base({ type: TaskType.CONTENT_GENERATION, requiresSearch: false }),
    );
    expect(decision.provider).toBe(Provider.OPENROUTER);
  });

  it('lets an explicit requiresSearch=true override a non-search TaskType default', () => {
    // Router-level capability wins; application policy separately forbids
    // CONTENT_GENERATION + requiresSearch=true, but the router honours the flag.
    expect(requiresSearchProvider(base({ type: TaskType.CONTENT_GENERATION, requiresSearch: true }))).toBe(true);
  });
});
