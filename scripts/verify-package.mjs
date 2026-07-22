import { execFileSync } from 'node:child_process';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Invoke npm via the absolute Node binary + an absolute npm CLI script path.
// No bare-name spawn and no PATH lookup anywhere (sonar javascript:S4036).
const resolveNpmCli = () => {
  if (process.env.npm_execpath) return process.env.npm_execpath;
  const candidates = [
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error('Unable to locate the npm CLI script; set npm_execpath.');
};
const npmCliPath = resolveNpmCli();
const runNpm = (args, options = {}) => execFileSync(process.execPath, [npmCliPath, ...args], options);
const workspace = await mkdtemp(join(tmpdir(), 'llm-router-package-'));
let tarball;
try {
  const packed = JSON.parse(runNpm(['pack', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }));
  const artifact = packed[0];
  tarball = join(root, artifact.filename);
  const unexpected = artifact.files.map(entry => entry.path).filter(path => !(
    path === 'package.json' || path === 'README.md' || path === 'ARCHITECTURE.md' || path.startsWith('dist/')
  ));
  if (unexpected.length > 0) throw new Error(`Unexpected package files: ${unexpected.join(', ')}`);

  await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'llm-router-package-smoke', private: true, type: 'module' }, null, 2));
  const registry = process.env.NPM_CONFIG_REGISTRY ?? process.env.npm_config_registry ?? 'https://registry.npmjs.org';
  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', `--registry=${registry}`, tarball], { cwd: workspace, stdio: 'inherit', env: process.env });
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
