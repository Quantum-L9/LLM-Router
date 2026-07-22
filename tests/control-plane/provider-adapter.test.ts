import { describe, expect, it } from 'vitest';
import type { LLMProviderAdapter, LLMExecutionResult, ModelCapability } from '../../src/control-plane/provider-adapter.js';
import type { LLMRoutePlan } from '../../src/control-plane/contracts.js';

class FakeAdapter implements LLMProviderAdapter {
  readonly provider = 'fake';
  capabilities(): readonly ModelCapability[] {
    return [{ provider: 'fake', model: 'model-a', modality: 'multimodal', max_context_tokens: 1000, max_output_tokens: 100, supports_json_mode: true, supports_search: false, supports_citations: false, supports_tools: true, supports_streaming: true, pricing_version: 'pricing/v1' }];
  }
  async execute(_plan: LLMRoutePlan, _request: { system_prompt: string; user_prompt: string; signal?: AbortSignal }, context: { trace_id: string; attempt_id: string; deadline_at: string }): Promise<LLMExecutionResult> {
    return { output: `${context.trace_id}:${context.attempt_id}`, provider_request_id: 'provider-request', input_tokens: 1, output_tokens: 1, total_tokens: 2, cost: 0.01, latency_ms: 1, citations: [], finish_reason: 'stop', pricing_version: 'pricing/v1' };
  }
}

describe('provider adapter contract', () => {
  it('supports capability, cancellation, attempt, usage, and pricing metadata', async () => {
    const adapter: LLMProviderAdapter = new FakeAdapter();
    expect(adapter.capabilities()[0]).toMatchObject({ supports_tools: true, pricing_version: 'pricing/v1' });
    const result = await adapter.execute({} as LLMRoutePlan, { system_prompt: 's', user_prompt: 'u', signal: new AbortController().signal }, { trace_id: 'trace', attempt_id: 'attempt', deadline_at: '2026-07-20T12:00:00.000Z' });
    expect(result).toMatchObject({ output: 'trace:attempt', total_tokens: 2, provider_request_id: 'provider-request' });
  });
});
