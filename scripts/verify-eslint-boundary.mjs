import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: root });
const [result] = await eslint.lintText("import { OpenRouterClient } from './providers/openrouter.js';\nvoid OpenRouterClient;\n", { filePath: join(root, 'src', 'boundary-probe.ts') });
if (!result.messages.some(message => message.ruleId === 'no-restricted-imports' && message.severity === 2)) {
  throw new Error('Provider boundary rule failed to reject a direct production import');
}
console.log('Provider boundary rule verified.');
