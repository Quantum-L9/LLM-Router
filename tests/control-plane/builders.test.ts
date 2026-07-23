import { describe, expect, it } from 'vitest';
import { buildExecutionRecord, buildFeedbackSignal, buildRoutePlan, buildTaskProfile, verifyExecutionRecord, verifyFeedbackSignal, verifyRoutePlan, verifyTaskProfile } from '../../src/control-plane/builders.js';

const profileInput = {
  action: 'review', node_id: 'node-a', tenant_id: 'tenant-a', task_family: 'architecture_review' as const,
  complexity: 'high' as const, data_sensitivity: 'internal' as const, requires_search: false,
  requires_citations: false, requires_json: true, required_output_schema: 'schemas/review/v1',
  freshness_requirement: 'none' as const, modality: 'text' as const, expected_output_tokens: 2000,
  max_latency_class: 'normal' as const, evidence_required: true, prompt_contract_ref: 'prompts/review/v1',
  validation_profile: 'strict_json' as const,
};

function routeInput(taskProfileHash: string, requestId = 'request-a', reason = 'Selected by policy') {
  return {
    request_id: requestId,
    task_profile_hash: taskProfileHash,
    selected: { provider: 'openrouter' as const, model: 'anthropic/claude-sonnet-4', temperature: 0.2, max_tokens: 2000, reasoning_depth: 'high' as const, response_format: 'json' as const },
    search: { enabled: false, provider: null, search_mode: null, search_context_size: null, recency_filter: null, variations: null, reasoning_effort: null },
    fallback_chain: [{ provider: 'openrouter' as const, model: 'openai/gpt-4o' }, { provider: 'openrouter' as const, model: 'google/gemini-2.5-pro' }],
    policy_decision: { status: 'allowed' as const, applied_rules: ['tenant-default', 'internal-data'], blockers: [] },
    budget_decision: { status: 'allowed' as const, reason: 'within budget' },
    provider_health_decision: { status: 'healthy' as const, reason: 'recent success' },
    learned_candidate_refs: ['candidate-b', 'candidate-a'],
    route_reason: reason,
    dispatch_allowed: true,
  };
}

describe('Control Plane builders', () => {
  it('builds, freezes, and verifies a task profile', () => {
    const profile = buildTaskProfile(profileInput);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(verifyTaskProfile(profile)).toEqual(profile);
    expect(() => verifyTaskProfile({ ...profile, action: 'tampered' })).toThrow(/hash mismatch/);
  });

  it('separates route equivalence, plan identity, and complete content', () => {
    const profile = buildTaskProfile(profileInput);
    const first = buildRoutePlan(routeInput(profile.task_profile_hash));
    const second = buildRoutePlan({
      ...routeInput(profile.task_profile_hash, 'request-b', 'Different prose'),
      budget_decision: { status: 'allowed', reason: 'different budget explanation' },
      provider_health_decision: { status: 'healthy', reason: 'different health explanation' },
    });
    expect(first.route_fingerprint).toBe(second.route_fingerprint);
    expect(first.plan_id).not.toBe(second.plan_id);
    expect(first.content_hash).not.toBe(second.content_hash);
    expect(first.fallback_chain.map(target => target.model)).toEqual(['google/gemini-2.5-pro', 'openai/gpt-4o']);
    expect(first.learned_candidate_refs).toEqual(['candidate-a', 'candidate-b']);
    expect(verifyRoutePlan(first)).toEqual(first);
  });

  it('rejects unsafe runtime input before normalization can execute it', () => {
    const cyclic: Record<string, unknown> = { ...profileInput };
    cyclic.self = cyclic;
    expect(() => buildTaskProfile(cyclic as never)).toThrow(/cyclic/);

    let getterExecuted = false;
    const accessor = { ...profileInput } as Record<string, unknown>;
    Object.defineProperty(accessor, 'action', {
      enumerable: true,
      get: () => {
        getterExecuted = true;
        return 'review';
      },
    });
    expect(() => buildTaskProfile(accessor as never)).toThrow(/accessors/);
    expect(getterExecuted).toBe(false);
  });

  it('detects identity and content tampering', () => {
    const profile = buildTaskProfile(profileInput);
    const plan = buildRoutePlan(routeInput(profile.task_profile_hash));
    expect(() => verifyRoutePlan({ ...plan, route_fingerprint: `route_${'0'.repeat(32)}` })).toThrow(/fingerprint mismatch/);
    expect(() => verifyRoutePlan({ ...plan, route_reason: 'tampered' })).toThrow(/hash mismatch/);
  });

  it('builds and verifies execution records and feedback signals', () => {
    const profile = buildTaskProfile(profileInput);
    const plan = buildRoutePlan(routeInput(profile.task_profile_hash));
    const hash = 'a'.repeat(64);
    const record = buildExecutionRecord({ request_id: 'request-a', plan_id: plan.plan_id, route_fingerprint: plan.route_fingerprint, tenant_id: 'tenant-a', node_id: 'node-a', action: 'review', task_profile_hash: profile.task_profile_hash, provider: 'openrouter', model: 'anthropic/claude-sonnet-4', config_hash: hash, prompt_hash: hash, input_hash: hash, output_hash: hash, input_tokens: 10, output_tokens: 20, total_tokens: 30, cost: 0.02, latency_ms: 120, citations_count: 0, fallback_used: false, fallback_from: null, validation_status: 'passed', schema_valid: true, downstream_accepted: true, quality_score: 0.9, failure_reason: null, provider_request_id: 'provider-request', pricing_version: 'pricing/2026-07', finish_reason: 'stop', generated_at: '2026-07-20T12:00:00.000Z' });
    expect(verifyExecutionRecord(record)).toEqual(record);
    const signal = buildFeedbackSignal({ signal_type: 'route_success', severity: 'info', task_profile_hash: profile.task_profile_hash, route_fingerprint: plan.route_fingerprint, plan_id: plan.plan_id, evidence_refs: ['evidence-b', 'evidence-a'] });
    expect(signal.evidence_refs).toEqual(['evidence-a', 'evidence-b']);
    expect(verifyFeedbackSignal(signal)).toEqual(signal);
  });
});
