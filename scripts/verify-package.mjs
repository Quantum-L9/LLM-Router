import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), 'llm-router-package-'));
let tarball;
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }));
  const artifact = packed[0];
  tarball = join(root, artifact.filename);
  const unexpected = artifact.files.map(entry => entry.path).filter(path => !(
    path === 'package.json' || path === 'README.md' || path === 'ARCHITECTURE.md' || path.startsWith('dist/')
  ));
  if (unexpected.length > 0) throw new Error(`Unexpected package files: ${unexpected.join(', ')}`);

  await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'llm-router-package-smoke', private: true, type: 'module' }, null, 2));
  const registry = process.env.NPM_CONFIG_REGISTRY ?? process.env.npm_config_registry ?? 'https://registry.npmjs.org';
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', `--registry=${registry}`, tarball], { cwd: workspace, stdio: 'inherit', env: process.env });
  const smoke = `
    const root = await import('@quantum-l9/llm-router');
    const openrouter = await import('@quantum-l9/llm-router/openrouter');
    const perplexity = await import('@quantum-l9/llm-router/perplexity');
    const vision = await import('@quantum-l9/llm-router/vision');
    if (typeof root.L9LLMRouter !== 'function') throw new Error('root export missing');
    if (typeof openrouter.OpenRouterClient !== 'function') throw new Error('openrouter export missing');
    if (typeof perplexity.PerplexityClient !== 'function') throw new Error('perplexity export missing');
    if (!vision.VIEWPORTS) throw new Error('vision export missing');
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', smoke], { cwd: workspace, stdio: 'inherit' });
  console.log(`Package smoke passed: ${basename(tarball)}`);
} finally {
  await rm(workspace, { recursive: true, force: true });
  if (tarball) await rm(tarball, { force: true });
}
