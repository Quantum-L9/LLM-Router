import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]));
  return nested.flat();
}
const files = (await walk(join(root, 'tests'))).filter(file => file.endsWith('.test.ts')).sort();
let cases = 0;
for (const file of files) {
  const text = await readFile(file, 'utf8');
  cases += (text.match(/\b(?:it|test)(?:\.each)?\s*\(/g) ?? []).length;
}
console.log(JSON.stringify({ files: files.map(file => relative(root, file)), fileCount: files.length, testCaseDeclarations: cases }, null, 2));
