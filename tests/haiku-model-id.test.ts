import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../src/index.js';
import { OpenRouterClient } from '../src/providers/openrouter.js';
import type { ChatCompletionRequest, ChatCompletionResult, ChatTransport } from '../src/providers/openai-transport.js';
import { GeneralModel, Provider, TaskComplexity, TaskType, type GeneralModelConfig } from '../src/types.js';

class CapturingTransport implements ChatTransport {
  requests: ChatCompletionRequest[] = [];
  async create(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.requests.push(request);
    return { id: 'req', choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  }
}

describe('CLAUDE_HAIKU OpenRouter model id', () => {
  it('uses anthropic/claude-haiku-4.5 in enum and CODE_GENERATION+LOW routing', () => {
    expect(GeneralModel.CLAUDE_HAIKU).toBe('anthropic/claude-haiku-4.5');
    const route = resolveRoute({ type: TaskType.CODE_GENERATION, complexity: TaskComplexity.LOW });
    expect(route.model).toBe(GeneralModel.CLAUDE_HAIKU);
  });

  it('maps CLAUDE_HAIKU to the OpenRouter request model id', async () => {
    const transport = new CapturingTransport();
    const client = new OpenRouterClient('key', 'app', 1000, transport);
    const config: GeneralModelConfig = {
      model: GeneralModel.CLAUDE_HAIKU,
      provider: Provider.OPENROUTER,
      temperature: 0.1,
      maxTokens: 100,
      estimatedCostPerCall: 0.01,
      resolutionReason: 'test',
    };
    await client.complete(config, 'system', 'user');
    expect(transport.requests[0]?.model).toBe('anthropic/claude-haiku-4.5');
  });
});
