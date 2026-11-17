import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDowngradedModel, resolveRoute } from '../src/index.js';
import { getFallbackChain } from '../src/matrices/general-matrix.js';
import { MODEL_RATES_PER_1M } from '../src/pricing.js';
import { OpenRouterClient } from '../src/providers/openrouter.js';
import type { ChatCompletionRequest, ChatCompletionResult, ChatTransport } from '../src/providers/openai-transport.js';
import { resolveVisionConfig } from '../src/vision/index.js';
import { GeneralModel, Provider, TaskComplexity, TaskType, type GeneralModelConfig } from '../src/types.js';

// The one canonical table of routable OpenRouter model ids.
const CANONICAL_FILE = join('src', 'types.ts');
// An OpenRouter model id is `<vendor>/<model>`; Perplexity Sonar ids carry no vendor prefix.
const MODEL_ID_LITERAL = /['"`]((?:anthropic|openai|google|meta-llama|mistralai|x-ai|deepseek|qwen|cohere|perplexity)\/[A-Za-z0-9._:-]+)['"`]/g;

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
}

const canonical = new Set<string>(Object.values(GeneralModel));

class CapturingTransport implements ChatTransport {
  requests: ChatCompletionRequest[] = [];
  async create(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.requests.push(request);
    return { id: 'req', choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  }
}

describe('routable model ids come from one canonical table', () => {
  it('declares no model-id string literal in src/ outside the GeneralModel enum', () => {
    const stray = walk('src')
      .filter(file => file.endsWith('.ts') && file !== CANONICAL_FILE)
      .flatMap(file => [...readFileSync(file, 'utf8').matchAll(MODEL_ID_LITERAL)].map(match => `${file}: ${match[1]}`));
    expect(stray).toEqual([]);
  });

  it('routes every task type and complexity to a canonical model', () => {
    const visionTypes = [TaskType.VISUAL_QA, TaskType.SCREENSHOT_ANALYSIS, TaskType.LAYOUT_VALIDATION] as const;
    for (const complexity of Object.values(TaskComplexity)) {
      for (const type of Object.values(TaskType).filter(type => !(visionTypes as readonly TaskType[]).includes(type))) {
        const route = resolveRoute({ type, complexity, requiresSearch: false });
        if (route.provider === Provider.OPENROUTER) expect(canonical.has(route.model)).toBe(true);
      }
      for (const type of visionTypes) {
        for (const imageCount of [1, 2]) expect(canonical.has(resolveVisionConfig(type, complexity, imageCount).model)).toBe(true);
      }
    }
  });

  it('keeps every fallback chain and downgrade target canonical, and every model priced', () => {
    for (const model of canonical) {
      for (const fallback of getFallbackChain(model as GeneralModel)) expect(canonical.has(fallback)).toBe(true);
      for (const tier of ['fast', 'strategic', 'critical'] as const) expect(canonical.has(getDowngradedModel(model as GeneralModel, Provider.OPENROUTER, tier))).toBe(true);
    }
    expect(new Set(Object.keys(MODEL_RATES_PER_1M))).toEqual(canonical);
  });

  it('sends exactly the canonical id to OpenRouter for every model', async () => {
    const transport = new CapturingTransport();
    const client = new OpenRouterClient('key', 'app', 1000, transport);
    for (const model of canonical) {
      const config: GeneralModelConfig = { model: model as GeneralModel, provider: Provider.OPENROUTER, temperature: 0.1, maxTokens: 10, estimatedCostPerCall: 0.01, resolutionReason: 'test' };
      await client.complete(config, 'system', 'user');
    }
    expect(transport.requests.map(request => request.model)).toEqual([...canonical]);
  });

  it('no longer routes ids OpenRouter retired (404 "no provider serves this model anymore")', () => {
    for (const retired of ['anthropic/claude-sonnet-4', 'anthropic/claude-opus-4']) expect(canonical.has(retired)).toBe(false);
    expect(GeneralModel.CLAUDE_SONNET).toBe('anthropic/claude-sonnet-4.6');
    expect(GeneralModel.CLAUDE_SONNET_VISION).toBe('anthropic/claude-sonnet-4.6');
    expect(GeneralModel.CLAUDE_OPUS).toBe('anthropic/claude-opus-4.6');
  });
});
