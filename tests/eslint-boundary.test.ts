import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('ESLint provider boundary', () => {
  it('rejects a production provider bypass', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [result] = await eslint.lintText("import { OpenRouterClient } from './providers/openrouter.js';\nvoid OpenRouterClient;\n", { filePath: 'src/boundary-probe.ts' });
    expect(result.messages.some(message => message.ruleId === 'no-restricted-imports' && message.severity === 2)).toBe(true);
  });

  it('allows the composition root to import providers', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [result] = await eslint.lintText("import { OpenRouterClient } from './providers/openrouter.js';\nvoid OpenRouterClient;\n", { filePath: 'src/index.ts' });
    expect(result.messages.some(message => message.ruleId === 'no-restricted-imports')).toBe(false);
  });
});
