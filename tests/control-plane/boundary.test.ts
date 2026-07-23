import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src', 'control-plane');
function files(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('Control Plane fixed boundaries', () => {
  it('contains no forbidden implementation imports', () => {
    const forbidden = /(^|\/)(openai|axios|undici|graphiti|neo4j|providers?|gate|transportpacket)(\/|$)|node:https?|node:net|node:tls/i;
    const offenders: string[] = [];
    for (const file of files(ROOT)) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      source.forEachChild(node => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && forbidden.test(node.moduleSpecifier.text)) offenders.push(`${file}:${node.moduleSpecifier.text}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('contains no implicit time, randomness, network URLs, or tenant literals', () => {
    const offenders: string[] = [];
    for (const file of files(ROOT)) {
      const text = readFileSync(file, 'utf8');
      if (/\bDate\.now\s*\(|\bnew\s+Date\s*\(|\bMath\.random\s*\(|\brandomUUID\s*\(/.test(text)) offenders.push(`${file}:volatile`);
      if (/https?:\/\//.test(text)) offenders.push(`${file}:url`);
      if (/safehavenrr|tenant-[0-9]/i.test(text)) offenders.push(`${file}:tenant`);
    }
    expect(offenders).toEqual([]);
  });

  it('is not exposed as a stable package export', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.exports).not.toHaveProperty('./control-plane');
  });
});
