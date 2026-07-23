import { describe, expect, it } from 'vitest';
import { buildExecutionRecord, buildRoutePlan, buildTaskProfile } from '../../src/control-plane/builders.js';

const baseProfile = { action: 'vision', node_id: 'n', tenant_id: 't', task_family: 'vision_analysis' as const, complexity: 'medium' as const, data_sensitivity: 'public' as const, requires_search: false, requires_citations: false, requires_json: false, required_output_schema: null, freshness_requirement: 'none' as const, modality: 'vision' as const, expected_output_tokens: 100, max_latency_class: 'normal' as const, evidence_required: false, prompt_contract_ref: null, validation_profile: 'visual' as const };

describe('Control Plane contract refinements', () => {
  it('rejects contradictory TaskProfile fields', () => {
    expect(() => buildTaskProfile({ ...baseProfile, requires_json: true, required_output_schema: null })).toThrow(/output schema/);
    expect(() => buildTaskProfile({ ...baseProfile, modality: 'vision', validation_profile: 'freeform' })).toThrow(/visual/);
  });

  it('rejects disabled search carrying configuration', () => {
    const profile = buildTaskProfile(baseProfile);
    expect(() => buildRoutePlan({ request_id: 'r', task_profile_hash: profile.task_profile_hash, selected: { provider: 'openrouter', model: 'm', temperature: 0, max_tokens: 1, reasoning_depth: 'none', response_format: 'text' }, search: { enabled: false, provider: 'perplexity', search_mode: null, search_context_size: null, recency_filter: null, variations: null, reasoning_effort: null }, fallback_chain: [], policy_decision: { status: 'allowed', applied_rules: [], blockers: [] }, budget_decision: { status: 'allowed', reason: 'ok' }, provider_health_decision: { status: 'healthy', reason: 'ok' }, learned_candidate_refs: [], route_reason: 'ok', dispatch_allowed: true })).toThrow(/disabled search/);
  });

  it('rejects blocked decisions marked dispatchable', () => {
    const profile = buildTaskProfile(baseProfile);
    expect(() => buildRoutePlan({ request_id: 'r', task_profile_hash: profile.task_profile_hash, selected: { provider: 'openrouter', model: 'm', temperature: 0, max_tokens: 1, reasoning_depth: 'none', response_format: 'text' }, search: { enabled: false, provider: null, search_mode: null, search_context_size: null, recency_filter: null, variations: null, reasoning_effort: null }, fallback_chain: [], policy_decision: { status: 'blocked', applied_rules: [], blockers: ['policy'] }, budget_decision: { status: 'allowed', reason: 'ok' }, provider_health_decision: { status: 'healthy', reason: 'ok' }, learned_candidate_refs: [], route_reason: 'blocked', dispatch_allowed: true })).toThrow(/dispatch_allowed/);
    expect(() => buildRoutePlan({ request_id: 'r', task_profile_hash: profile.task_profile_hash, selected: { provider: 'openrouter', model: 'm', temperature: 0, max_tokens: 1, reasoning_depth: 'none', response_format: 'text' }, search: { enabled: false, provider: null, search_mode: null, search_context_size: null, recency_filter: null, variations: null, reasoning_effort: null }, fallback_chain: [], policy_decision: { status: 'allowed', applied_rules: [], blockers: [] }, budget_decision: { status: 'allowed', reason: 'ok' }, provider_health_decision: { status: 'unknown', reason: 'no evidence' }, learned_candidate_refs: [], route_reason: 'unknown health', dispatch_allowed: true })).toThrow(/dispatch_allowed/);
  });

  it('rejects impossible execution accounting', () => {
    const hash = 'a'.repeat(64);
    expect(() => buildExecutionRecord({ request_id: 'r', plan_id: `plan_${'a'.repeat(32)}`, route_fingerprint: `route_${'b'.repeat(32)}`, tenant_id: 't', node_id: 'n', action: 'a', task_profile_hash: hash, provider: 'openrouter', model: 'm', config_hash: hash, prompt_hash: hash, input_hash: hash, output_hash: hash, input_tokens: 1, output_tokens: 2, total_tokens: 99, cost: 0, latency_ms: 0, citations_count: 0, fallback_used: false, fallback_from: null, validation_status: 'not_run', schema_valid: null, downstream_accepted: null, quality_score: null, failure_reason: null, provider_request_id: null, pricing_version: 'v', finish_reason: null, generated_at: '2026-07-20T12:00:00.000Z' })).toThrow(/total_tokens/);
    expect(() => buildExecutionRecord({ request_id: 'r', plan_id: `plan_${'a'.repeat(32)}`, route_fingerprint: `route_${'b'.repeat(32)}`, tenant_id: 't', node_id: 'n', action: 'a', task_profile_hash: hash, provider: 'openrouter', model: 'm', config_hash: hash, prompt_hash: hash, input_hash: hash, output_hash: hash, input_tokens: 1, output_tokens: 2, total_tokens: 3, cost: 0, latency_ms: 0, citations_count: 0, fallback_used: false, fallback_from: null, validation_status: 'passed', schema_valid: null, downstream_accepted: true, quality_score: null, failure_reason: null, provider_request_id: null, pricing_version: 'v', finish_reason: null, generated_at: '2026-07-20T12:00:00.000Z' })).toThrow(/schema_valid/);
    expect(() => buildExecutionRecord({ request_id: 'r', plan_id: `plan_${'a'.repeat(32)}`, route_fingerprint: `route_${'b'.repeat(32)}`, tenant_id: 't', node_id: 'n', action: 'a', task_profile_hash: hash, provider: 'openrouter', model: 'm', config_hash: hash, prompt_hash: hash, input_hash: hash, output_hash: hash, input_tokens: 1, output_tokens: 2, total_tokens: 3, cost: 0, latency_ms: 0, citations_count: 0, fallback_used: false, fallback_from: null, validation_status: 'not_run', schema_valid: true, downstream_accepted: null, quality_score: null, failure_reason: null, provider_request_id: null, pricing_version: 'v', finish_reason: null, generated_at: '2026-07-20T12:00:00.000Z' })).toThrow(/not_run/);
  });
});
